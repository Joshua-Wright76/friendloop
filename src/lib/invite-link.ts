import { randomBytes } from "node:crypto";
import { and, count, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { groups, inviteLinks, memberships } from "@/db/schema";
import { MAX_MEMBERS_PER_LOOP } from "./rate-limit";
import { newToken } from "./tokens";

/**
 * A loop's shareable invite link: one per loop, for the owner to paste into a
 * group chat when nobody knows everyone's email. Holding it only lets someone
 * *ask* to join with an address; they're in once they confirm that address.
 */

/** 16 random bytes: 128 bits is plenty for a link that only starts a confirmation, and it stays short to paste. */
function newInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

/** The loop's current invite token, made the first time anyone asks. */
export async function inviteLinkToken(groupId: string): Promise<string> {
  await db.insert(inviteLinks).values({ groupId, token: newInviteToken() }).onConflictDoNothing();
  const [row] = await db.select({ token: inviteLinks.token }).from(inviteLinks).where(eq(inviteLinks.groupId, groupId)).limit(1);
  return row.token;
}

/** A new link for the loop. The old one stops working at once, including confirmation emails it already sent. */
export async function resetInviteLink(groupId: string, at: Date): Promise<string> {
  const token = newInviteToken();
  await db
    .insert(inviteLinks)
    .values({ groupId, token, createdAt: at })
    .onConflictDoUpdate({ target: inviteLinks.groupId, set: { token, createdAt: at } });
  return token;
}

export type InviteLoop = {
  groupId: string;
  groupName: string;
  /** For the join page to wear the loop's own paper and header picture. */
  group: typeof groups.$inferSelect;
  /** Whoever runs the loop, as the loop shows them. */
  ownerName: string;
  people: number;
  full: boolean;
};

/** What the join page can say about the loop behind a link: its name, who runs it, and how many are in. */
export async function loopForInvite(token: string): Promise<InviteLoop | null> {
  if (!token) return null;
  const [row] = await db
    .select({ group: groups })
    .from(inviteLinks)
    .innerJoin(groups, eq(groups.id, inviteLinks.groupId))
    .where(eq(inviteLinks.token, token))
    .limit(1);
  if (!row) return null;
  const { group } = row;

  const [[owner], [{ people }]] = await Promise.all([
    db
      .select({ name: memberships.name, email: memberships.email })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), eq(memberships.access, "owner"), isNull(memberships.revokedAt)))
      .limit(1),
    db
      .select({ people: count() })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt))),
  ]);

  return {
    groupId: group.id,
    groupName: group.name,
    group,
    ownerName: owner ? owner.name ?? owner.email.split("@")[0] : group.name,
    people: Number(people),
    full: Number(people) >= MAX_MEMBERS_PER_LOOP,
  };
}

/** Whether this person is in the loop already, was taken out of it, or neither (null). */
export async function placeIn(
  groupId: string,
  user: { id: string; email: string },
): Promise<"in" | "removed" | null> {
  const found = await db
    .select({ revokedAt: memberships.revokedAt })
    .from(memberships)
    .where(and(
      eq(memberships.groupId, groupId),
      or(eq(memberships.userId, user.id), eq(memberships.email, user.email)),
    ));
  if (found.some((row) => !row.revokedAt)) return "in";
  return found.length ? "removed" : null;
}

export type JoinOutcome =
  | { status: "joined" | "already"; groupId: string }
  /** The owner took them out; the link doesn't override that. An email invite does. */
  | { status: "removed" | "full"; groupId: string }
  /** The link was reset, or never existed. */
  | { status: "gone" };

/**
 * Put a signed-in person into the loop behind an invite link, as someone who
 * answers. Their address is already proven: they're signed in.
 */
export async function joinWithInvite(input: {
  token: string;
  user: { id: string; email: string; name: string | null };
  at: Date;
}): Promise<JoinOutcome> {
  const loop = await loopForInvite(input.token);
  if (!loop) return { status: "gone" };
  const { groupId } = loop;

  const state = await placeIn(groupId, input.user);
  if (state) return { status: state === "in" ? "already" : "removed", groupId };
  if (loop.full) return { status: "full", groupId };

  const created = await db
    .insert(memberships)
    .values({
      groupId,
      userId: input.user.id,
      email: input.user.email,
      name: input.user.name,
      access: "member",
      participation: "contributor",
      replyToken: newToken(),
      invitedAt: input.at,
      acceptedAt: input.at,
    })
    .onConflictDoNothing()
    .returning({ id: memberships.id });
  // Two tabs racing: the other one made it, which is the same result.
  return { status: created.length ? "joined" : "already", groupId };
}

/** Where someone goes once a join was tried: into the loop, or back to the link's page, which says what stopped it. */
export function joinDestination(token: string, outcome: JoinOutcome): string {
  if (outcome.status === "joined") return `/g/${outcome.groupId}?welcome=joined`;
  if (outcome.status === "already") return `/g/${outcome.groupId}`;
  return `/join/${encodeURIComponent(token)}`;
}

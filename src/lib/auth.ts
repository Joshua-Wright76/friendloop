import { cookies } from "next/headers";
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { magicLinks, memberships, sessions, users } from "@/db/schema";
import { hashToken, newToken } from "./tokens";
import { getNow } from "./clock";
import { cleanDisplayName } from "./names";
import { isValidTimezone } from "./timezone";
import { signInEmail } from "./email/templates";
import { sendEmail } from "./email/send";
import { signInUrl } from "./urls";

export const SESSION_COOKIE = "fl_session";
const SESSION_DAYS = 30;
const LINK_MINUTES = 15;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  timezone: string;
};

/**
 * Send a sign-in link. The account is created when the link is *used*, so an
 * address nobody has ever seen leaves exactly the same trace as a known one.
 */
export async function requestMagicLink(rawEmail: string): Promise<void> {
  const email = normalizeEmail(rawEmail);
  const at = await getNow();
  const token = newToken();

  await db.insert(magicLinks).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(at.getTime() + LINK_MINUTES * 60 * 1000),
  });

  const rendered = signInEmail(signInUrl(token));
  await sendEmail({
    ...rendered,
    to: email,
    kind: "signin",
    dedupeKey: `signin:${hashToken(token)}`,
  });
}

export type ConfirmResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; reason: "expired" | "used" | "unknown" };

/** What the browser can tell us at sign-in, so we never have to ask later. */
export type ConfirmProfile = {
  name?: string | null;
  timezone?: string | null;
};

/**
 * Single use, 15 minutes. Called from a POST, never a GET — mail scanners fetch GETs.
 *
 * The two extra fields are the point of no return: this is the first moment a
 * person is definitely a person, so the zone their browser reports and the name
 * they typed are captured here and reused by every deadline and byline after.
 */
export async function confirmMagicLink(
  token: string,
  profile: ConfirmProfile = {},
): Promise<ConfirmResult> {
  const at = await getNow();
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(token)))
    .limit(1);

  if (!link) return { ok: false, reason: "unknown" };
  if (link.usedAt) return { ok: false, reason: "used" };
  if (link.expiresAt.getTime() <= at.getTime()) return { ok: false, reason: "expired" };

  const claimed = await db
    .update(magicLinks)
    .set({ usedAt: at })
    .where(and(eq(magicLinks.id, link.id), isNull(magicLinks.usedAt)))
    .returning({ id: magicLinks.id });
  if (claimed.length === 0) return { ok: false, reason: "used" };

  const name = cleanDisplayName(profile.name);
  const timezone = profile.timezone && isValidTimezone(profile.timezone) ? profile.timezone.trim() : null;

  const [user] = await db
    .insert(users)
    .values({ email: link.email, name: name ?? undefined, timezone: timezone ?? undefined })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        email: link.email,
        ...(name ? { name } : {}),
        ...(timezone ? { timezone } : {}),
      },
    })
    .returning();

  // Attach any memberships that were waiting for this address to sign in.
  await db
    .update(memberships)
    .set({ userId: user.id, acceptedAt: sql`coalesce(${memberships.acceptedAt}, ${at.toISOString()})` })
    .where(and(eq(memberships.email, link.email), isNull(memberships.userId)));

  // An invited person often arrives without a name. Take theirs for every loop
  // that was still showing an email handle.
  if (name) {
    await db
      .update(memberships)
      .set({ name })
      .where(and(eq(memberships.email, link.email), isNull(memberships.name)));
  }

  await createSession(user.id, at);
  return { ok: true, user: toCurrentUser(user) };
}

function toCurrentUser(user: typeof users.$inferSelect): CurrentUser {
  return { id: user.id, email: user.email, name: user.name, timezone: user.timezone };
}

export async function createSession(userId: string, at: Date): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(at.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function currentUser(): Promise<CurrentUser | null> {
  "use cache: private";
  cacheLife({ stale: 300 });
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  cacheTag(token ? `session:${token}` : "session:anonymous");
  if (!token) return null;

  const at = await getNow({ skipConnection: true });
  const rows = await db
    .select({ id: users.id, email: users.email, name: users.name, timezone: users.timezone })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, at)))
    .limit(1);

  return rows[0] ?? null;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    updateTag(`session:${token}`);
  }
  jar.delete(SESSION_COOKIE);
}

/** The reply link is the credential for contributors: no account, no session. */
export async function membershipFromReplyToken(token: string) {
  const rows = await db
    .select({
      membership: memberships,
      userId: memberships.userId,
      email: memberships.email,
    })
    .from(memberships)
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export type LinkPeek =
  | { state: "valid"; email: string }
  | { state: "expired"; email: string }
  | { state: "used"; email: string }
  | { state: "unknown" };

/** Read the link without burning it, so the confirm page can say what happened. */
export async function peekMagicLink(token: string): Promise<LinkPeek> {
  const at = await getNow();
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(eq(magicLinks.tokenHash, hashToken(token)))
    .limit(1);

  if (!link) return { state: "unknown" };
  if (link.usedAt) return { state: "used", email: link.email };
  if (link.expiresAt.getTime() <= at.getTime()) return { state: "expired", email: link.email };
  return { state: "valid", email: link.email };
}

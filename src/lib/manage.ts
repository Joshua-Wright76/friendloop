import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  groups,
  issues,
  memberships,
  outbox,
  questions,
  users,
} from "@/db/schema";
import { newToken } from "./tokens";
import { emailThemeOf, inviteEmail } from "./email/templates";
import { sendEmail } from "./email/send";
import { sendPromptEmails } from "./notify";
import { replyUrl, url } from "./urls";
import { deliveryInstant } from "./schedule";
import { INVITE_DAYS } from "./reply";
import { reorderIds } from "./question-order";
import { newQuestionTexts } from "./question-packs";
import { snapshotQuestionsForIssue } from "./round-questions";
import { checkPoll } from "./poll";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function parseEmails(raw: string): string[] {
  return [...new Set(raw.split(/[\s,;]+/).map(normalizeEmail).filter((email) => email.includes("@")))];
}

export type CreateLoopInput = {
  ownerUserId: string;
  ownerEmail: string;
  ownerName?: string | null;
  name: string;
  mode: "group" | "from_you";
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  questions: string[];
  at: Date;
};

export async function createLoop(input: CreateLoopInput): Promise<string> {
  const [group] = await db
    .insert(groups)
    .values({
      name: input.name,
      displayName: input.name,
      mode: input.mode,
      timezone: input.timezone,
      promptWeekday: input.promptWeekday,
      promptHour: input.promptHour,
      cadenceWeeks: input.cadenceWeeks,
      createdAt: input.at,
    })
    .returning({ id: groups.id });

  await db.insert(memberships).values({
    groupId: group.id,
    userId: input.ownerUserId,
    email: normalizeEmail(input.ownerEmail),
    name: input.ownerName ?? null,
    access: "owner",
    participation: "contributor",
    replyToken: newToken(),
    acceptedAt: input.at,
  });

  const texts = input.questions.map((text) => text.trim()).filter(Boolean);
  if (texts.length > 0) {
    await db.insert(questions).values(
      texts.map((text, index) => ({ groupId: group.id, text, position: index })),
    );
  }

  return group.id;
}

/** Invite by email. Re-inviting a removed address revives it with a fresh token. */
export async function inviteMembers(input: {
  groupId: string;
  emails: string[];
  participation: "contributor" | "reader";
  actorName: string;
  at: Date;
  personalNote?: string;
}): Promise<{ invited: number; skipped: number }> {
  const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
  if (!group) throw new Error("not-found");

  const participation = group.mode === "from_you" ? "reader" : input.participation;
  let invited = 0;
  let skipped = 0;

  for (const email of parseEmails(input.emails.join(" "))) {
    const [existing] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), eq(memberships.email, email)))
      .limit(1);

    if (existing && !existing.revokedAt) {
      skipped += 1;
      continue;
    }

    const token = newToken();
    let membershipId: string;

    if (existing) {
      await db
        .update(memberships)
        .set({
          replyToken: token,
          revokedAt: null,
          invitedAt: input.at,
          acceptedAt: null,
          participation,
        })
        .where(eq(memberships.id, existing.id));
      membershipId = existing.id;
    } else {
      const [created] = await db
        .insert(memberships)
        .values({
          groupId: group.id,
          email,
          access: "member",
          participation,
          replyToken: token,
          invitedAt: input.at,
        })
        .returning({ id: memberships.id });
      membershipId = created.id;
    }

    await sendInvite({
      membershipId,
      email,
      token,
      groupId: group.id,
      groupName: group.name,
      group,
      inviterName: input.actorName,
      participation,
      personalNote: input.personalNote,
    });
    invited += 1;
  }

  return { invited, skipped };
}

export async function resendInvite(input: {
  groupId: string;
  membershipId: string;
  actorName: string;
}): Promise<boolean> {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.groupId, input.groupId)))
    .limit(1);
  if (!membership || membership.revokedAt) return false;

  const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
  if (!group) return false;

  await sendInvite({
    membershipId: membership.id,
    email: membership.email,
    token: membership.replyToken,
    groupId: group.id,
    groupName: group.name,
    group,
    inviterName: input.actorName,
    participation: membership.participation,
  });
  return true;
}

async function sendInvite(input: {
  membershipId: string;
  email: string;
  token: string;
  groupId: string;
  groupName: string;
  group: typeof groups.$inferSelect;
  inviterName: string;
  participation: "contributor" | "reader";
  personalNote?: string;
}) {
  // A resend needs its own dedupe key, or the outbox would swallow it.
  const [{ sent }] = await db
    .select({ sent: count() })
    .from(outbox)
    .where(sql`${outbox.dedupeKey} like ${`invite:${input.membershipId}:%`}`);

  const rendered = inviteEmail({
    groupName: input.groupName,
    inviterName: input.inviterName,
    url: replyUrl(input.token),
    isReader: input.participation === "reader",
    personalNote: input.personalNote,
    theme: emailThemeOf(input.group),
  });

  await sendEmail({
    ...rendered,
    to: input.email,
    kind: "invite",
    dedupeKey: `invite:${input.membershipId}:${Number(sent) + 1}`,
    groupId: input.groupId,
    membershipId: input.membershipId,
    fromName: input.groupName,
  });
}

export async function removeMember(groupId: string, membershipId: string, at: Date) {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId)))
    .limit(1);
  if (!membership || membership.access === "owner") return false;

  await db.update(memberships).set({ revokedAt: at }).where(eq(memberships.id, membershipId));
  return true;
}

export async function setParticipation(
  groupId: string,
  membershipId: string,
  participation: "contributor" | "reader",
) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return false;

  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId)))
    .limit(1);
  if (!membership) return false;

  // The owner always writes; in `from_you` nobody else does.
  if (membership.access === "owner") return false;
  const next = group.mode === "from_you" ? "reader" : participation;

  await db.update(memberships).set({ participation: next }).where(eq(memberships.id, membershipId));
  return true;
}

export async function setAccess(groupId: string, membershipId: string, access: "admin" | "member") {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId)))
    .limit(1);
  if (!membership || membership.access === "owner") return false;

  await db.update(memberships).set({ access }).where(eq(memberships.id, membershipId));
  return true;
}

class HandoverRefused extends Error {}

/**
 * Hand the loop to an existing admin: they become the owner, the founder becomes
 * an admin. One transaction, and each half is guarded by the state it expects, so
 * a double submit, a second tab, or two owners racing each other can never leave
 * a loop with zero owners or two. Returns false when nothing changed.
 *
 * Only an admin who has opened their invitation is eligible: handing a loop to an
 * address nobody has ever answered from would orphan it. Sessions and reply
 * tokens are untouched, so nobody is signed out by a handover.
 */
export async function transferOwnership(groupId: string, fromId: string, toId: string): Promise<boolean> {
  if (fromId === toId) return false;

  try {
    await db.transaction(async (tx) => {
      const [group] = await tx.select({ mode: groups.mode }).from(groups).where(eq(groups.id, groupId)).limit(1);
      if (!group) throw new HandoverRefused();

      const demoted = await tx
        .update(memberships)
        .set({
          access: "admin",
          // In a from_you loop the owner is the only writer, and the new owner is now that.
          ...(group.mode === "from_you" ? { participation: "reader" as const } : {}),
        })
        .where(and(
          eq(memberships.id, fromId),
          eq(memberships.groupId, groupId),
          eq(memberships.access, "owner"),
          isNull(memberships.revokedAt),
        ))
        .returning({ id: memberships.id });
      if (demoted.length === 0) throw new HandoverRefused();

      const promoted = await tx
        .update(memberships)
        .set({ access: "owner", participation: "contributor" })
        .where(and(
          eq(memberships.id, toId),
          eq(memberships.groupId, groupId),
          eq(memberships.access, "admin"),
          isNull(memberships.revokedAt),
          isNotNull(memberships.acceptedAt),
        ))
        .returning({ id: memberships.id });
      if (promoted.length === 0) throw new HandoverRefused();
    });
    return true;
  } catch (error) {
    if (error instanceof HandoverRefused) return false;
    throw error;
  }
}

export async function addQuestion(groupId: string, text: string, at: Date) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${questions.position}), -1)::int` })
    .from(questions)
    .where(eq(questions.groupId, groupId));

  const [row] = await db
    .insert(questions)
    .values({ groupId, text: trimmed, position: maxPosition + 1, createdAt: at })
    .returning({ id: questions.id });
  return row.id;
}

/**
 * Add a poll to the pool. It is a question like any other, so ordering, rotation,
 * archiving and issue snapshots all treat it the same way.
 */
export async function addPoll(
  groupId: string,
  input: { prompt: string; options: string[]; multiple: boolean },
  at: Date,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const checked = checkPoll(input);
  if (!checked.ok) return checked;

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${questions.position}), -1)::int` })
    .from(questions)
    .where(eq(questions.groupId, groupId));

  const [row] = await db
    .insert(questions)
    .values({
      groupId,
      text: checked.poll.prompt,
      kind: "poll",
      pollMultiple: checked.poll.multiple,
      pollOptions: checked.poll.options,
      position: maxPosition + 1,
      createdAt: at,
    })
    .returning({ id: questions.id });
  return { ok: true, id: row.id };
}

/** Add several library questions at once, skipping any already in the pool. */
export async function addQuestionTexts(groupId: string, texts: string[], at: Date): Promise<number> {
  const existing = await db
    .select({ text: questions.text })
    .from(questions)
    .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt)));
  const fresh = newQuestionTexts(texts, existing.map((row) => row.text));
  if (fresh.length === 0) return 0;

  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${questions.position}), -1)::int` })
    .from(questions)
    .where(eq(questions.groupId, groupId));

  await db.insert(questions).values(
    fresh.map((question, index) => ({
      groupId,
      text: question,
      position: maxPosition + 1 + index,
      createdAt: at,
    })),
  );
  return fresh.length;
}

export async function reorderQuestion(groupId: string, questionId: string, targetIndex: number) {
  return db.transaction(async (tx) => {
    // Serialize reorder requests for this group so each one applies to the latest order.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${groupId}, 0))`);
    const rows = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt)))
      .orderBy(questions.position);
    const orderedIds = reorderIds(rows.map((row) => row.id), questionId, targetIndex);
    if (orderedIds.every((id, index) => id === rows[index]?.id)) return false;

    const cases = orderedIds.map((id, position) => sql`when ${id} then ${position}`);
    await tx.update(questions).set({
      position: sql`case ${questions.id} ${sql.join(cases, sql` `)} else ${questions.position} end`,
    }).where(and(
      eq(questions.groupId, groupId),
      isNull(questions.archivedAt),
      inArray(questions.id, orderedIds),
    ));
    return true;
  });
}

export async function archiveQuestion(groupId: string, questionId: string, at: Date) {
  await db
    .update(questions)
    .set({ archivedAt: at, active: false, skipNext: false })
    .where(and(eq(questions.id, questionId), eq(questions.groupId, groupId)));
}

export async function toggleSkipNext(groupId: string, questionId: string) {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.groupId, groupId)))
    .limit(1);
  if (!row) return false;

  await db
    .update(questions)
    .set({ skipNext: !row.skipNext })
    .where(eq(questions.id, questionId));
  return true;
}

export type LoopSettings = {
  name: string;
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  shareEnabled: boolean;
  /** Optional so existing callers keep the current setting. */
  commentsEnabled?: boolean;
};

export async function updateLoopSettings(groupId: string, settings: LoopSettings) {
  const [before] = await db
    .select({ shareEnabled: groups.shareEnabled })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);

  await db
    .update(groups)
    .set({
      name: settings.name,
      displayName: settings.name,
      timezone: settings.timezone,
      promptWeekday: settings.promptWeekday,
      promptHour: settings.promptHour,
      cadenceWeeks: settings.cadenceWeeks,
      shareEnabled: settings.shareEnabled,
      ...(settings.commentsEnabled === undefined ? {} : { commentsEnabled: settings.commentsEnabled }),
    })
    .where(eq(groups.id, groupId));

  // Turning sharing on has to reach the rounds that already went out, or the
  // setting only ever applies to the next delivery.
  if (settings.shareEnabled && !before?.shareEnabled) {
    await backfillShareTokens(groupId);
  }
}

/** Give delivered rounds a share token they don't have yet. */
export async function backfillShareTokens(groupId: string): Promise<number> {
  const missing = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "delivered"), isNull(issues.shareToken)));

  for (const issue of missing) {
    await db.update(issues).set({ shareToken: newToken() }).where(eq(issues.id, issue.id));
  }
  return missing.length;
}

/** New links for every delivered round; anything already handed out stops working. */
export async function rotateShareLinks(groupId: string): Promise<number> {
  const rounds = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "delivered")));

  for (const issue of rounds) {
    await db.update(issues).set({ shareToken: newToken() }).where(eq(issues.id, issue.id));
  }
  return rounds.length;
}

export async function setPaused(groupId: string, paused: boolean, at: Date) {
  await db
    .update(groups)
    .set(
      paused
        ? { pausedAt: at }
        : // Resuming starts the rhythm from now, so a long pause never backfills.
          { pausedAt: null, lastSlotAt: at },
    )
    .where(eq(groups.id, groupId));
}

export async function deleteLoop(groupId: string) {
  await db.delete(groups).where(eq(groups.id, groupId));
}

/** Start a round by hand, without waiting for the schedule. */
export async function openIssueNow(groupId: string, at: Date): Promise<{ issueId: string; number: number } | null> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return null;

  const [open] = await db
    .select({ id: issues.id, number: issues.number })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open")))
    .limit(1);
  if (open) return { issueId: open.id, number: open.number };

  const deliversAt = deliveryInstant(at, group);

  // Same race as the scheduled sweep: two "Send now" clicks can compute the same
  // number, and only the slot conflict is ignored. Lock the loop first.
  const issue = await db.transaction(async (tx) => {
    await tx.execute(sql`select id from ${groups} where ${groups.id} = ${groupId} for update`);

    const [{ maxNumber }] = await tx
      .select({ maxNumber: sql<number>`coalesce(max(${issues.number}), 0)::int` })
      .from(issues)
      .where(eq(issues.groupId, groupId));

    const [created] = await tx
      .insert(issues)
      .values({ groupId, number: maxNumber + 1, slotAt: at, opensAt: at, deliversAt })
      .onConflictDoNothing({ target: [issues.groupId, issues.slotAt] })
      .returning({ id: issues.id, number: issues.number });
    return created ?? null;
  });

  if (!issue) return null;

  const questionCount = await snapshotQuestionsForIssue({ group, issueId: issue.id });

  await db.update(groups).set({ lastSlotAt: at }).where(eq(groups.id, groupId));

  await sendPromptEmails({
    group,
    issueId: issue.id,
    issueNumber: issue.number,
    deliversAt,
    questionCount,
  });

  return { issueId: issue.id, number: issue.number };
}

export async function membersOf(groupId: string) {
  return db
    .select({
      id: memberships.id,
      email: memberships.email,
      name: memberships.name,
      photoUrl: memberships.photoUrl,
      access: memberships.access,
      participation: memberships.participation,
      invitedAt: memberships.invitedAt,
      acceptedAt: memberships.acceptedAt,
      userId: memberships.userId,
    })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.revokedAt)))
    .orderBy(sql`case when ${memberships.access} = 'owner' then 0 when ${memberships.access} = 'admin' then 1 else 2 end`, memberships.invitedAt);
}

export async function userById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export const INVITE_TTL_DAYS = INVITE_DAYS;

export function inviteExpired(invitedAt: Date, acceptedAt: Date | null, at: Date): boolean {
  if (acceptedAt) return false;
  return invitedAt.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000 <= at.getTime();
}

export function loopUrl(groupId: string) {
  return url(`/g/${groupId}`);
}

/** Unused-in-UI helper kept for the probe: which loops have write access. */
export async function loopsForUser(userId: string) {
  return db
    .select({ groupId: memberships.groupId, access: memberships.access })
    .from(memberships)
    .where(inArray(memberships.userId, [userId]));
}

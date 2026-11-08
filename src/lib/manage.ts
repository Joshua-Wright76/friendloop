import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  emailSuppressions,
  groups,
  issues,
  memberships,
  outbox,
  questions,
  users,
} from "@/db/schema";
import { consume, LIMITS, MAX_MEMBERS_PER_LOOP, limitKey } from "./rate-limit";
import { newToken } from "./tokens";
import { emailThemeOf, inviteEmail } from "./email/templates";
import { sendEmail } from "./email/send";
import { replyUrl, unsubscribeUrl, url } from "./urls";
import { groupSchedule, nextSlot } from "./schedule";
import { openRound, rescheduleOpenRound, setLoopPaused } from "./rounds";
import {
  addPoolQuestion,
  addToOpenRound,
  fillOpenRound,
  removeFromOpenRound,
  resizeOpenRound,
} from "./round-questions";
import { reorderIds } from "./question-order";
import { newQuestionTexts } from "./question-packs";
import { checkPoll } from "./poll";
import { eraseLoop } from "./erasure";

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
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  questions: string[];
  at: Date;
  /** The stationery chosen in the wizard, already validated; null keeps the original Gingham. */
  themePreset?: string | null;
  themeAccent?: string | null;
  themeBackground?: string | null;
  themePaperPack?: string | null;
  themeTapePack?: string | null;
  themeMascot?: string | null;
};

export async function createLoop(input: CreateLoopInput): Promise<string> {
  const [group] = await db
    .insert(groups)
    .values({
      name: input.name,
      displayName: input.name,
      timezone: input.timezone,
      promptWeekday: input.promptWeekday,
      promptHour: input.promptHour,
      cadenceWeeks: input.cadenceWeeks,
      themePreset: input.themePreset ?? null,
      themeAccent: input.themeAccent ?? null,
      themeBackground: input.themeBackground ?? null,
      themePaperPack: input.themePaperPack ?? null,
      themeTapePack: input.themeTapePack ?? null,
      themeMascot: input.themeMascot ?? null,
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

  // Round 1 takes answers from the start, so whoever joins can write straight away.
  await openRound({ groupId: group.id, at: input.at, prompt: true });

  return group.id;
}

/** Invite by email. Re-inviting a removed address revives it with a fresh token. */
export async function inviteMembers(input: {
  groupId: string;
  emails: string[];
  participation: "contributor" | "reader";
  actorName: string;
  /** Who is sending. Their daily allowance is what stops a spam run through a loop. */
  actorUserId: string;
  at: Date;
  personalNote?: string;
}): Promise<{ invited: number; skipped: number; limited: number }> {
  const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
  if (!group) throw new Error("not-found");

  const participation = input.participation;
  let invited = 0;
  let skipped = 0;
  let limited = 0;

  const [{ current }] = await db
    .select({ current: count() })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt)));
  let room = MAX_MEMBERS_PER_LOOP - Number(current);

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

    if (room <= 0 || !(await consume(limitKey.invite(input.actorUserId), LIMITS.invite, input.at)).allowed) {
      limited += 1;
      continue;
    }
    room -= 1;

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

  return { invited, skipped, limited };
}

/** How many loops this person runs now. Someone can start another while under the cap. */
export async function ownedLoopCount(userId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.access, "owner"), isNull(memberships.revokedAt)));
  return Number(total);
}

export type MemberEmailResult = "changed" | "invalid" | "taken" | "limited" | "refused";

/**
 * Fix the address of someone with no account yet, a typo in the invitation being
 * the usual reason. Their answers stay theirs, since they hang off the membership.
 * The old link stops working, because whoever got it may be the wrong person. Someone
 * who has signed in moves their own address instead (`requestEmailChange`).
 */
export async function changeMemberEmail(input: {
  groupId: string;
  membershipId: string;
  newEmail: string;
  actorName: string;
  actorUserId: string;
  at: Date;
}): Promise<MemberEmailResult> {
  const email = normalizeEmail(input.newEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "invalid";

  const [group] = await db.select().from(groups).where(eq(groups.id, input.groupId)).limit(1);
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, input.membershipId), eq(memberships.groupId, input.groupId), isNull(memberships.revokedAt)))
    .limit(1);
  if (!group || !membership || membership.access === "owner" || membership.userId) return "refused";
  if (membership.email === email) return "taken";

  const [clash] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), eq(memberships.email, email)))
    .limit(1);
  if (clash) return "taken";

  if (!(await consume(limitKey.invite(input.actorUserId), LIMITS.invite, input.at)).allowed) return "limited";

  const token = newToken();
  // The unsent mail still holds the old link and address, so it goes rather than following them.
  await db
    .delete(outbox)
    .where(and(eq(outbox.membershipId, membership.id), inArray(outbox.status, ["pending", "failed"])));
  await db
    .update(memberships)
    .set({ email, replyToken: token, invitedAt: input.at, acceptedAt: null, mutedAt: null })
    .where(eq(memberships.id, membership.id));

  await sendInvite({
    membershipId: membership.id,
    email,
    token,
    groupId: group.id,
    groupName: group.name,
    group,
    inviterName: input.actorName,
    participation: membership.participation,
  });
  return "changed";
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

  const [{ unsubscribeToken }] = await db
    .select({ unsubscribeToken: memberships.unsubscribeToken })
    .from(memberships)
    .where(eq(memberships.id, input.membershipId))
    .limit(1);

  const rendered = inviteEmail({
    groupName: input.groupName,
    inviterName: input.inviterName,
    url: replyUrl(input.token),
    isReader: input.participation === "reader",
    personalNote: input.personalNote,
    theme: emailThemeOf(input.group),
    unsubscribeUrl: unsubscribeUrl(unsubscribeToken),
  });

  await sendEmail({
    ...rendered,
    to: input.email,
    kind: "invite",
    dedupeKey: `invite:${input.membershipId}:${Number(sent) + 1}`,
    groupId: input.groupId,
    membershipId: input.membershipId,
    fromName: input.groupName,
    unsubscribeToken,
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
  const [membership] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.id, membershipId), eq(memberships.groupId, groupId)))
    .limit(1);
  if (!membership) return false;

  // The owner always writes.
  if (membership.access === "owner") return false;

  await db.update(memberships).set({ participation }).where(eq(memberships.id, membershipId));
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
 * Hand the loop to anyone in it who has joined, in one step: they become the
 * owner, the founder becomes an admin. One transaction, and each half is guarded
 * by the state it expects, so a double submit, a second tab, or two owners racing
 * each other can never leave a loop with zero owners or two. Returns false when
 * nothing changed.
 *
 * "Joined" means they have answered or signed in at least once: handing a loop to
 * an address nobody has ever used would orphan it. Sessions and reply tokens are
 * untouched, so nobody is signed out by a handover.
 */
export async function transferOwnership(groupId: string, fromId: string, toId: string): Promise<boolean> {
  if (fromId === toId) return false;

  try {
    await db.transaction(async (tx) => {
      const demoted = await tx
        .update(memberships)
        .set({ access: "admin" })
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
          inArray(memberships.access, ["admin", "member"]),
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

/*
 * The question list of the old Questions tab, on the unified pool
 * (docs/questions-unify-design.md, PR B). Its questions are the pool's written
 * and poll items marked `active`: turn-takers, or every-round items in a loop
 * that asks every question each round. The Questions page that replaces the tab
 * works on the whole list.
 */

/** The old tab's questions: written and poll items it treats as questions, not stopped. */
export function poolQuestionCondition(groupId: string) {
  return and(eq(questions.groupId, groupId), eq(questions.active, true), isNull(questions.archivedAt));
}

export async function addQuestion(groupId: string, text: string, at: Date) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return addPoolQuestion({ groupId, text: trimmed, at });
}

/**
 * Add a poll to the pool. It is a question like any other, so ordering, rotation,
 * stopping and round snapshots all treat it the same way.
 */
export async function addPoll(
  groupId: string,
  input: { prompt: string; options: string[]; multiple: boolean },
  at: Date,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const checked = checkPoll(input);
  if (!checked.ok) return checked;
  const id = await addPoolQuestion({
    groupId,
    text: checked.poll.prompt,
    format: "poll",
    pollMultiple: checked.poll.multiple,
    pollOptions: checked.poll.options,
    at,
  });
  return { ok: true, id };
}

/** Add several library questions at once, skipping any already in the pool. */
export async function addQuestionTexts(groupId: string, texts: string[], at: Date): Promise<number> {
  const existing = await db
    .select({ text: questions.text })
    .from(questions)
    .where(poolQuestionCondition(groupId));
  const fresh = newQuestionTexts(texts, existing.map((row) => row.text));
  for (const text of fresh) await addPoolQuestion({ groupId, text, at });
  return fresh.length;
}

/**
 * Move a question in the list. The list is the queue: its order is the order the
 * coming rounds take their turns in. The round people are answering keeps its own.
 */
export async function reorderQuestion(groupId: string, questionId: string, targetIndex: number) {
  return db.transaction(async (tx) => {
    // Serialize reorder requests for this group so each one applies to the latest order.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${groupId}, 0))`);
    const rows = await tx
      .select({ id: questions.id, position: questions.position })
      .from(questions)
      .where(poolQuestionCondition(groupId))
      .orderBy(questions.position, questions.createdAt, questions.id);
    const orderedIds = reorderIds(rows.map((row) => row.id), questionId, targetIndex);
    if (orderedIds.every((id, index) => id === rows[index]?.id)) return false;

    // The same positions, handed out in the new order: turn-takers and every-round
    // items each keep their place among the rest of the pool.
    const positions = rows.map((row) => row.position).sort((left, right) => left - right);
    const cases = orderedIds.map((id, index) => sql`when ${id} then ${positions[index]}`);
    await tx.update(questions).set({
      position: sql`case ${questions.id} ${sql.join(cases, sql` `)} else ${questions.position} end`,
    }).where(and(poolQuestionCondition(groupId), inArray(questions.id, orderedIds)));
    return true;
  });
}

/** Stop asking a question: it leaves the open round unless someone wrote there. */
export async function archiveQuestion(groupId: string, questionId: string, at: Date) {
  const stopped = await db
    .update(questions)
    .set({ archivedAt: at, skipNext: false })
    .where(and(poolQuestionCondition(groupId), eq(questions.id, questionId)))
    .returning({ id: questions.id });
  if (stopped.length === 0) return;
  await removeFromOpenRound(groupId, questionId);
  // An "all questions" round, or one short of its count, takes the next in line.
  await fillOpenRound(groupId);
}

/**
 * The old "Skip this round": take the question out of the open round (unless
 * someone has written there) and put it first in line for the next one. Asking
 * again puts it back. `skip_next` only remembers the choice for the list; the
 * next round clears it.
 */
export async function toggleSkipNext(groupId: string, questionId: string) {
  const [row] = await db
    .select()
    .from(questions)
    .where(and(poolQuestionCondition(groupId), eq(questions.id, questionId)))
    .limit(1);
  if (!row) return false;

  if (row.skipNext) {
    await db.update(questions).set({ skipNext: false }).where(eq(questions.id, questionId));
    await addToOpenRound(groupId, questionId);
    return true;
  }
  if ((await removeFromOpenRound(groupId, questionId)) === "written") return true;
  await db.update(questions).set({ skipNext: true }).where(eq(questions.id, questionId));
  // The round takes the next in line instead, as skipping always did.
  await fillOpenRound(groupId);
  return true;
}

/**
 * The old "Each round asks" setting. A count makes the loop's questions take
 * turns; "All questions" asks every one of them each round. The open round asks
 * the new number at once.
 */
export async function setQuestionsPerRound(groupId: string, questionsPerRound: number | null) {
  await db.update(groups).set({ questionsPerRound }).where(eq(groups.id, groupId));
  await db
    .update(questions)
    .set({ frequency: questionsPerRound === null ? "every_round" : "rotating" })
    .where(and(
      eq(questions.groupId, groupId),
      eq(questions.active, true),
      inArray(questions.frequency, questionsPerRound === null ? ["rotating"] : ["every_round"]),
    ));
  await resizeOpenRound(groupId);
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

export async function updateLoopSettings(groupId: string, settings: LoopSettings, at?: Date) {
  const [before] = await db
    .select()
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

  // The schedule is when the issue goes out, so a new one moves the open round's
  // delivery with it: the round people are writing goes out on the new day.
  const moved =
    before &&
    (before.timezone !== settings.timezone ||
      before.promptWeekday !== settings.promptWeekday ||
      before.promptHour !== settings.promptHour ||
      before.cadenceWeeks !== settings.cadenceWeeks);
  if (moved && at) {
    const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
    if (group) await rescheduleOpenRound(group, nextSlot(groupSchedule(group), at));
  }
}

/** Give delivered rounds a share token they don't have yet. */
export async function backfillShareTokens(groupId: string): Promise<number> {
  const missing = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "delivered"), isNull(issues.shareToken)));
  await setShareTokens(missing.map((issue) => issue.id));
  return missing.length;
}

/** A fresh token for each round, in one statement: one round trip however many rounds. */
async function setShareTokens(issueIds: string[]): Promise<void> {
  if (issueIds.length === 0) return;
  const rows = issueIds.map((id) => sql`(${id}::uuid, ${newToken()})`);
  await db.execute(sql`
    update ${issues} set share_token = fresh.token
    from (values ${sql.join(rows, sql`, `)}) as fresh(id, token)
    where ${issues.id} = fresh.id
  `);
}

/** New links for every delivered round; anything already handed out stops working. */
export async function rotateShareLinks(groupId: string): Promise<number> {
  const rounds = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "delivered")));
  await setShareTokens(rounds.map((issue) => issue.id));
  return rounds.length;
}

export async function setPaused(groupId: string, paused: boolean, at: Date) {
  await setLoopPaused(groupId, paused, at);
}

/** Every round, answer and comment goes, and so does every photo and voice note. */
export async function deleteLoop(groupId: string) {
  await eraseLoop(groupId);
}

export async function membersOf(groupId: string) {
  return db
    .select({
      id: memberships.id,
      email: memberships.email,
      name: memberships.name,
      photoUrl: memberships.photoUrl,
      charm: memberships.charm,
      avatarFrame: memberships.avatarFrame,
      access: memberships.access,
      participation: memberships.participation,
      invitedAt: memberships.invitedAt,
      acceptedAt: memberships.acceptedAt,
      userId: memberships.userId,
      mutedAt: memberships.mutedAt,
      suppression: emailSuppressions.reason,
    })
    .from(memberships)
    .leftJoin(emailSuppressions, eq(emailSuppressions.email, sql`lower(${memberships.email})`))
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.revokedAt)))
    // The owner first, then everyone by when they joined. Neither a new role nor a
    // re-sent invite (fixing an address) moves anyone's card.
    .orderBy(sql`case when ${memberships.access} = 'owner' then 0 else 1 end`, memberships.createdAt, memberships.id);
}

export async function userById(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
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

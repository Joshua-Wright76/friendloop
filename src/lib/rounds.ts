import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, musicLinks, replies, replyMedia, users } from "@/db/schema";
import { carriedOver, groupSchedule, nextSlot } from "./schedule";
import { sendEmail } from "./email/send";
import { mailDeadline, roundAsks, sendPromptEmails } from "./notify";
import { deliveryEmail, emailMarksOf, emailThemeOf, pausedEmail, type AnswerBlock } from "./email/templates";
import { tallyPoll } from "./poll";
import { replyHasContentCondition } from "./reply-query";
import { isSectionLike } from "./asks";
import { copy, text } from "./copy.ts";
import { issueUrl, replyUrl, unsubscribeUrl, url } from "./urls";
import { newToken } from "./tokens";
import { snapshotRound } from "./round-questions";
import { placeDatedItems } from "./events";

/**
 * The round lifecycle. A loop always has exactly one round taking answers, from
 * the moment the one before it went out until its own delivery on the schedule:
 *
 * - creating a loop opens round 1, due at the first delivery;
 * - delivering a round opens the next one, due at the delivery after;
 * - a round with nothing in it is carried over to the next delivery, and after
 *   `EMPTY_DELIVERIES_BEFORE_PAUSE` empty deliveries in a row it is dropped and
 *   the loop pauses;
 * - pausing holds the open round; resuming picks it up again (or opens a fresh
 *   one, if the loop paused itself).
 *
 * The sweep runs the scheduled half of this; "Send now" and resume run the rest.
 */

type GroupRow = typeof groups.$inferSelect;
type IssueRow = typeof issues.$inferSelect;

/** Three empty deliveries in a row: the original date and two carry-overs. */
export const EMPTY_DELIVERIES_BEFORE_PAUSE = 3;

export type OpenedRound = { issueId: string; number: number; deliversAt: Date; created: boolean };

/**
 * Open the loop's next round, due at the next delivery after `at` (or after
 * `after.deliversAt`, when a round is being sent early and its own slot must not
 * also open a round). Idempotent: if another round is already open (other than
 * `after`, which is on its way out), that one is returned instead.
 */
export async function openRound(input: {
  groupId: string;
  at: Date;
  /** Email each contributor the questions. A delivery carries them in its own email instead. */
  prompt: boolean;
  after?: Pick<IssueRow, "id" | "deliversAt">;
}): Promise<OpenedRound | null> {
  const { groupId, at, after } = input;

  // Two triggers can reach this loop at once (the sweep's two schedules, a double
  // click). The row lock makes the second one see the first one's round.
  const outcome = await db.transaction(async (tx) => {
    const [group] = await tx.select().from(groups).where(eq(groups.id, groupId)).for("update");
    if (!group) return null;

    const [open] = await tx
      .select({ id: issues.id, number: issues.number, deliversAt: issues.deliversAt })
      .from(issues)
      .where(and(
        eq(issues.groupId, groupId),
        eq(issues.status, "open"),
        after ? ne(issues.id, after.id) : undefined,
      ))
      .limit(1);
    if (open) return { group, round: { issueId: open.id, number: open.number, deliversAt: open.deliversAt, created: false } };

    const from = after && after.deliversAt.getTime() > at.getTime() ? after.deliversAt : at;
    const deliversAt = nextSlot(groupSchedule(group), from);

    const [{ maxNumber }] = await tx
      .select({ maxNumber: sql<number>`coalesce(max(${issues.number}), 0)::int` })
      .from(issues)
      .where(eq(issues.groupId, groupId));

    const [created] = await tx
      .insert(issues)
      .values({
        groupId,
        number: maxNumber + 1,
        slotAt: deliversAt,
        opensAt: at,
        deliversAt,
      })
      .onConflictDoNothing({ target: [issues.groupId, issues.slotAt] })
      .returning({ id: issues.id, number: issues.number });
    if (!created) return null;
    // Under the loop's lock, so two openings can never take the same turn in the queue.
    await snapshotRound({ ex: tx, group, issueId: created.id, opensAt: at, deliversAt });
    return { group, round: { issueId: created.id, number: created.number, deliversAt, created: true } };
  });

  if (!outcome) return null;
  const { group, round } = outcome;
  if (!round.created) return round;

  if (input.prompt) {
    await sendPromptEmails({
      group,
      issueId: round.issueId,
      issueNumber: round.number,
      deliversAt: round.deliversAt,
    });
  }
  return round;
}

/** The loop's open round, if it has one. */
export async function openRoundOf(groupId: string): Promise<IssueRow | null> {
  const [open] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open")))
    .limit(1);
  return open ?? null;
}

/**
 * Point the open round at a new delivery, for a changed schedule or a resume.
 * Its slot moves too, so a round carried over before starts counting again.
 */
export async function rescheduleOpenRound(group: GroupRow, deliversAt: Date): Promise<void> {
  const open = await openRoundOf(group.id);
  if (!open || open.deliversAt.getTime() === deliversAt.getTime()) return;
  await db
    .update(issues)
    .set({ deliversAt, slotAt: deliversAt })
    .where(and(eq(issues.id, open.id), eq(issues.status, "open")));
  await placeDatedItems({ group, issueId: open.id, opensAt: open.opensAt, deliversAt });
}

export type DeliveryOutcome = "delivered" | "carried" | "skipped" | "empty" | "gone";

/**
 * Send a round that is due, or that the owner is sending early (`early`).
 *
 * With answers in it, everyone gets the issue and the next round opens, its
 * questions riding along at the bottom of the same email. With nothing in it, a
 * scheduled delivery carries the round over to the next slot (or, after enough
 * empty deliveries, drops it and pauses the loop); an early send does nothing.
 *
 * Safe to repeat: the next round is found rather than opened twice, every email is
 * deduped, and only one caller wins the status change.
 */
export async function deliverRound(input: { issue: IssueRow; at: Date; early?: boolean }): Promise<DeliveryOutcome> {
  const { issue, at, early = false } = input;
  const [group] = await db.select().from(groups).where(eq(groups.id, issue.groupId)).limit(1);
  if (!group) return "gone";

  const [asked, rows] = await Promise.all([
    db
      .select()
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, issue.id))
      .orderBy(asc(issueQuestions.position), asc(issueQuestions.id)),
    db
      .select({
        replyId: replies.id,
        questionId: issueQuestions.id,
        question: issueQuestions.text,
        kind: issueQuestions.kind,
        adminOnly: issueQuestions.adminOnly,
        pollOptions: issueQuestions.pollOptions,
        pollChoices: replies.pollChoices,
        body: replies.body,
        photoUrl: replies.photoUrl,
        audioUrl: replies.audioUrl,
        audioDurationMs: replies.audioDurationMs,
        linkUrl: replies.linkUrl,
        linkTitle: musicLinks.title,
        authorName: memberships.name,
        authorEmail: memberships.email,
        authorCharm: memberships.charm,
        addedAfterDelivery: replies.addedAfterDelivery,
        createdAt: replies.createdAt,
      })
      .from(replies)
      .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
      .innerJoin(memberships, eq(memberships.id, replies.membershipId))
      .leftJoin(musicLinks, eq(musicLinks.url, replies.linkUrl))
      // Whatever is written goes out; an answer cleared back to nothing doesn't.
      .where(and(eq(replies.issueId, issue.id), replyHasContentCondition()))
      .orderBy(issueQuestions.position, memberships.createdAt),
  ]);

  if (rows.length === 0) {
    if (early) return "empty";
    return carryOrSkip({ issue, group, at });
  }

  // Questions read as answers; sections, photo walls and music picks as the cards they always were.
  const sectionLike = new Set(asked.filter(isSectionLike).map((question) => question.id));
  const answerRows = rows.filter((row) => !sectionLike.has(row.questionId));
  const answers: Array<{ adminOnly: boolean; block: AnswerBlock }> = answerRows.map((row) => ({
    adminOnly: row.adminOnly,
    block: {
      question: row.question,
      author: row.authorName ?? row.authorEmail.split("@")[0],
      authorCharm: row.authorCharm,
      body: row.kind === "poll" ? pollEmailChoice(row) : row.body,
      pollResults: row.kind === "poll" ? pollEmailResults(row, answerRows) : null,
      photoUrl: row.photoUrl,
      audioUrl: row.audioUrl,
      audioDurationMs: row.audioDurationMs,
      addedLater: row.addedAfterDelivery,
    },
  }));

  const cardRows = rows
    .filter((row) => sectionLike.has(row.questionId))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.replyId.localeCompare(right.replyId));
  const mediaCounts = new Map<string, number>();
  if (cardRows.length > 0) {
    const mediaRows = await db
      .select({ replyId: replyMedia.replyId })
      .from(replyMedia)
      .where(inArray(replyMedia.replyId, cardRows.map((row) => row.replyId)));
    for (const row of mediaRows) mediaCounts.set(row.replyId, (mediaCounts.get(row.replyId) ?? 0) + 1);
  }
  const sections = asked
    .filter((question) => sectionLike.has(question.id))
    .map((question) => ({
      fromSection: question.fromSection,
      adminOnly: question.adminOnly,
      title: question.text,
      emoji: question.emoji,
      answers: cardRows
        .filter((row) => row.questionId === question.id)
        .map((row) => ({
          author: row.authorName ?? row.authorEmail.split("@")[0],
          authorCharm: row.authorCharm,
          body: row.body,
          linkUrl: row.linkUrl,
          linkTitle: row.linkTitle,
          addedLater: row.addedAfterDelivery,
          photoCount: (mediaCounts.get(row.replyId) ?? 0) + (row.photoUrl ? 1 : 0),
        })),
    }))
    // A section from before keeps saying nobody added anything; a new card nobody answered isn't there.
    .filter((section) => section.answers.length > 0 || section.fromSection);

  let shareToken = issue.shareToken;
  if (group.shareEnabled && !shareToken) {
    shareToken = newToken();
    await db.update(issues).set({ shareToken }).where(eq(issues.id, issue.id));
  }

  // The next round opens before anyone is told, so the email can carry its questions.
  const next = await openRound({ groupId: group.id, at, prompt: false, after: issue });
  const nextAsks = next ? await roundAsks(next.issueId) : null;

  const everyone = await db
    .select({
      id: memberships.id,
      email: memberships.email,
      name: memberships.name,
      participation: memberships.participation,
      access: memberships.access,
      replyToken: memberships.replyToken,
      unsubscribeToken: memberships.unsubscribeToken,
      timezone: users.timezone,
    })
    .from(memberships)
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt)));

  // The owner's motto, seal, divider and sign-off: the same for everyone, so made once.
  const marks = emailMarksOf(group, { number: issue.number, deliveredAt: at }, next);

  for (const member of everyone) {
    const nextQuestions = nextAsks ? nextAsks(member) : [];
    // Rendered per member: the issue link, the next round's link and the "stop emails" link are theirs.
    const rendered = deliveryEmail({
      groupName: group.name,
      issueNumber: issue.number,
      issueName: issue.name,
      url: issueUrl(issue.id, member.replyToken),
      // Owners-only items are for the owner and admins, here as on the issue page.
      answers: answers
        .filter((answer) => !answer.adminOnly || member.access !== "member")
        .map((answer) => answer.block),
      sections: sections
        .filter((section) => !section.adminOnly || member.access !== "member")
        .map((section) => ({ title: section.title, emoji: section.emoji, answers: section.answers })),
      shareUrl: shareToken ? url(`/s/${shareToken}`) : null,
      next:
        next && member.participation === "contributor" && nextQuestions.length > 0
          ? {
              issueNumber: next.number,
              url: replyUrl(member.replyToken),
              deadlineLabel: mailDeadline(next.deliversAt, group.timezone, member.timezone),
              questions: nextQuestions,
            }
          : undefined,
      theme: emailThemeOf(group),
      unsubscribeUrl: unsubscribeUrl(member.unsubscribeToken),
      marks,
    });
    await sendEmail({
      ...rendered,
      to: member.email,
      kind: "delivery",
      dedupeKey: `delivery:${issue.id}:${member.id}`,
      groupId: group.id,
      issueId: issue.id,
      membershipId: member.id,
      fromName: group.displayName ?? group.name,
      unsubscribeToken: member.unsubscribeToken,
    });
  }

  // Conditional: whichever caller gets here first wins, the other is a no-op. The
  // emails above are deduped by `delivery:${issue.id}:${member.id}` either way.
  const claimed = await db
    .update(issues)
    .set({ status: "delivered", deliveredAt: at })
    .where(and(eq(issues.id, issue.id), eq(issues.status, "open")))
    .returning({ id: issues.id });
  return claimed.length > 0 ? "delivered" : "gone";
}

/**
 * An empty round at its delivery: carry it to the next slot, so people who meant
 * to write still can, unless it has already come up empty enough times in a row.
 */
async function carryOrSkip(input: { issue: IssueRow; group: GroupRow; at: Date }): Promise<DeliveryOutcome> {
  const { issue, group, at } = input;
  const schedule = groupSchedule(group);
  if (carriedOver(schedule, issue) + 1 < EMPTY_DELIVERIES_BEFORE_PAUSE) {
    const deliversAt = nextSlot(schedule, at);
    const moved = await db
      .update(issues)
      .set({ deliversAt })
      .where(and(eq(issues.id, issue.id), eq(issues.status, "open"), eq(issues.deliversAt, issue.deliversAt)))
      .returning({ id: issues.id });
    if (moved.length === 0) return "gone";
    await placeDatedItems({ group, issueId: issue.id, opensAt: issue.opensAt, deliversAt });
    return "carried";
  }
  await skipRound({ issue, group, at });
  return "skipped";
}

async function skipRound(input: { issue: IssueRow; group: GroupRow; at: Date }): Promise<void> {
  const { issue, group, at } = input;
  const updated = await db
    .update(issues)
    .set({ status: "skipped", skippedAt: at })
    .where(and(eq(issues.id, issue.id), eq(issues.status, "open")))
    .returning({ id: issues.id });
  if (updated.length === 0) return;

  await db.update(groups).set({ pausedAt: at }).where(eq(groups.id, group.id));

  const owners = await db
    .select({ id: memberships.id, email: memberships.email, unsubscribeToken: memberships.unsubscribeToken })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), eq(memberships.access, "owner")));

  for (const owner of owners) {
    const rendered = pausedEmail({
      groupName: group.name,
      url: url(`/g/${group.id}`),
      theme: emailThemeOf(group),
      unsubscribeUrl: unsubscribeUrl(owner.unsubscribeToken),
    });
    await sendEmail({
      ...rendered,
      to: owner.email,
      kind: "nudge",
      dedupeKey: `skipped:${issue.id}:${owner.id}`,
      groupId: group.id,
      issueId: issue.id,
      membershipId: owner.id,
      fromName: group.displayName ?? group.name,
      unsubscribeToken: owner.unsubscribeToken,
    });
  }
}

export type SendNowResult =
  | { state: "sent"; number: number; next: OpenedRound | null }
  | { state: "empty"; number: number }
  | { state: "none" };

/**
 * "Send now": the open round goes out at once with whatever is in, and the next
 * one opens straight away. It takes the place of this round's scheduled delivery,
 * so the next round is due at the slot after that, not in a few minutes.
 */
export async function sendRoundNow(groupId: string, at: Date): Promise<SendNowResult> {
  const issue = await openRoundOf(groupId);
  if (!issue) return { state: "none" };
  const outcome = await deliverRound({ issue, at, early: true });
  if (outcome === "empty") return { state: "empty", number: issue.number };
  const next = await openRoundOf(groupId);
  return {
    state: "sent",
    number: issue.number,
    next: next ? { issueId: next.id, number: next.number, deliversAt: next.deliversAt, created: true } : null,
  };
}

/** Pause holds the open round where it is; resume points it at the next delivery, or opens one. */
export async function setLoopPaused(groupId: string, paused: boolean, at: Date): Promise<void> {
  if (paused) {
    await db.update(groups).set({ pausedAt: at }).where(and(eq(groups.id, groupId), isNull(groups.pausedAt)));
    return;
  }

  const [group] = await db
    .update(groups)
    .set({ pausedAt: null })
    .where(eq(groups.id, groupId))
    .returning();
  if (!group) return;

  const open = await openRoundOf(groupId);
  if (open) {
    // A short pause between deliveries changes nothing; a long one never sends a
    // round the moment it is resumed.
    if (open.deliversAt.getTime() <= at.getTime()) {
      await rescheduleOpenRound(group, nextSlot(groupSchedule(group), at));
    }
    return;
  }
  // The loop paused itself after empty rounds: start fresh, and tell everyone.
  await openRound({ groupId, at, prompt: true });
}

/** How a poll answer reads in the delivery email: the pick. */
function pollEmailChoice(row: { pollOptions: string[] | null; pollChoices: number[] }): string {
  const options = row.pollOptions ?? [];
  return text(copy.polls.emails.chose, {
    choices: row.pollChoices.flatMap((index) => options[index] ?? []).join(", "),
  });
}

/** The quiet tally, shown once under the poll's question. */
function pollEmailResults(
  row: { questionId: string; pollOptions: string[] | null },
  rows: Array<{ questionId: string; pollChoices: number[] }>,
): string {
  const tally = tallyPoll(
    row.pollOptions ?? [],
    rows.filter((other) => other.questionId === row.questionId).map((other) => other.pollChoices),
  )
    .map((item) => text(copy.polls.issue.tallyLabel, { option: item.option, votes: item.votes }))
    .join(" · ");
  return text(copy.polls.emails.results, { tally });
}

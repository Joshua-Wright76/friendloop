import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  groups,
  issueQuestions,
  issues,
  memberships,
  replies,
  users,
} from "@/db/schema";
import { deliveryInstant, describeDeadline, dueSlot, groupSchedule, nextSlot } from "./schedule";
import { sendEmail, flushOutbox } from "./email/send";
import { sendPromptEmails } from "./notify";
import { deliveryEmail, emailThemeOf, reminderEmail, pausedEmail, type AnswerBlock } from "./email/templates";
import { tallyPoll } from "./poll";
import { REMINDER_LEADS_MS, wantsReminder } from "./reminders";
import { copy, text } from "./copy.ts";
import { issueUrl, replyUrl, unsubscribeUrl, url } from "./urls";
import { newToken } from "./tokens";
import { snapshotQuestionsForIssue } from "./round-questions";
import { snapshotSectionsForIssue } from "./sections";
import { snapshotEventsForIssue } from "./events";
import { purgeQueuedMedia } from "./media-cleanup.ts";
import { issueSections, sectionMedia, sectionReplies } from "@/db/schema";
import { pruneRateLimits } from "./rate-limit";

export type SweepReport = {
  opened: number;
  delivered: number;
  skipped: number;
  reminded: number;
  retried: number;
  /** Another trigger held the sweep lock, so this run did nothing. */
  busy: boolean;
  /** Stored files an earlier deletion queued and this run removed. */
  mediaPurged: number;
};

/** Arbitrary, fixed key for `pg_try_advisory_xact_lock`: one sweep at a time. */
const SWEEP_LOCK_KEY = 7_311_002;

/**
 * Reconcile the world at `at`. Safe to run at any frequency, from any number of
 * triggers, in any order: every step is idempotent through a unique constraint.
 *
 * The constraints make a doubled run correct; the lock makes it cheap. Without
 * it, two triggers landing together (the 15-minute GitHub schedule and the daily
 * Vercel cron) would both walk every loop and both try to send the same pending
 * outbox rows. The second caller returns at once with `busy: true`.
 *
 * Transaction-scoped on purpose: production talks to Neon through a
 * transaction-mode pooler, where a session lock could be taken on one server
 * connection and "released" on another. The lock transaction stays open on its
 * own pooled connection while the work runs on the others, and ends — releasing
 * the lock — however the work ends.
 */
export async function sweep({ at }: { at: Date }): Promise<SweepReport> {
  let report: SweepReport = emptyReport(true);
  await db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${SWEEP_LOCK_KEY}) as locked`,
    );
    if (!locked) return;
    report = await sweepUnlocked(at);
  });
  return report;
}

function emptyReport(busy: boolean): SweepReport {
  return { opened: 0, delivered: 0, skipped: 0, reminded: 0, retried: 0, mediaPurged: 0, busy };
}

async function sweepUnlocked(at: Date): Promise<SweepReport> {
  const report = emptyReport(false);

  report.opened = await openDueIssues(at);
  const delivery = await deliverDueIssues(at);
  report.delivered = delivery.delivered;
  report.skipped = delivery.skipped;
  report.reminded = await remindStragglers(at);
  report.retried = await flushOutbox();
  report.mediaPurged = await purgeQueuedMedia();
  // Housekeeping, not part of the report: closed abuse windows are just rows.
  await pruneRateLimits(at);
  return report;
}

async function openDueIssues(at: Date): Promise<number> {
  const active = await db.select().from(groups).where(isNull(groups.pausedAt));
  let opened = 0;

  for (const group of active) {
    const slot = dueSlot(groupSchedule(group), at);
    if (!slot) continue;

    const deliversAt = deliveryInstant(slot, group);

    // Two triggers can reach this loop at the same moment (Vercel cron and the
    // GitHub schedule). The slot's unique index alone is not enough: both would
    // also compute the same `number` and the second insert would fail on
    // `issues_group_number_idx` instead of being ignored. The row lock makes the
    // second trigger read the first one's number, so it collides on the slot and
    // `onConflictDoNothing` does its job.
    const inserted = await db.transaction(async (tx) => {
      await tx.execute(sql`select id from ${groups} where ${groups.id} = ${group.id} for update`);

      const [{ maxNumber }] = await tx
        .select({ maxNumber: sql<number>`coalesce(max(${issues.number}), 0)::int` })
        .from(issues)
        .where(eq(issues.groupId, group.id));

      return tx
        .insert(issues)
        .values({
          groupId: group.id,
          number: maxNumber + 1,
          slotAt: slot,
          opensAt: slot,
          deliversAt,
        })
        .onConflictDoNothing({ target: [issues.groupId, issues.slotAt] })
        .returning({ id: issues.id, number: issues.number });
    });

    // Another trigger already created this slot.
    if (inserted.length === 0) {
      await db.update(groups).set({ lastSlotAt: slot }).where(eq(groups.id, group.id));
      continue;
    }

    const issue = inserted[0];
    const questionCount = await snapshotQuestionsForIssue({ group, issueId: issue.id });
    await snapshotSectionsForIssue({ group, issueId: issue.id });
    await snapshotEventsForIssue({
      group,
      issueId: issue.id,
      opensAt: slot,
      deliversAt,
      nextSlotAt: nextSlot(groupSchedule(group), slot),
    });

    await sendPromptEmails({
      group,
      issueId: issue.id,
      issueNumber: issue.number,
      deliversAt,
      questionCount,
    });

    await db.update(groups).set({ lastSlotAt: slot }).where(eq(groups.id, group.id));
    opened += 1;
  }

  return opened;
}

async function deliverDueIssues(at: Date): Promise<{ delivered: number; skipped: number }> {
  const due = await db
    .select()
    .from(issues)
    .where(and(eq(issues.status, "open"), sql`${issues.deliversAt} <= ${at.toISOString()}`));

  let delivered = 0;
  let skipped = 0;

  for (const issue of due) {
    const [group] = await db.select().from(groups).where(eq(groups.id, issue.groupId)).limit(1);
    if (!group) continue;

    const allRows = await db
      .select({
        questionId: issueQuestions.id,
        question: issueQuestions.text,
        kind: issueQuestions.kind,
        pollOptions: issueQuestions.pollOptions,
        position: issueQuestions.position,
        pollChoices: replies.pollChoices,
        body: replies.body,
        photoUrl: replies.photoUrl,
        audioUrl: replies.audioUrl,
        audioDurationMs: replies.audioDurationMs,
        authorName: memberships.name,
        authorEmail: memberships.email,
        addedAfterDelivery: replies.addedAfterDelivery,
      })
      .from(replies)
      .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
      .innerJoin(memberships, eq(memberships.id, replies.membershipId))
      .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")))
      .orderBy(issueQuestions.position, memberships.createdAt);

    // A poll pick someone cleared after sending is not an answer.
    const rows = allRows.filter((row) => row.kind !== "poll" || row.pollChoices.length > 0);

    // Section answers are content too, but a truly empty issue stays skipped.
    const sectionRows = await db
      .select()
      .from(issueSections)
      .where(eq(issueSections.issueId, issue.id))
      .orderBy(issueSections.position);
    const sectionReplyRows = sectionRows.length
      ? await db
          .select({
            replyId: sectionReplies.id,
            issueSectionId: sectionReplies.issueSectionId,
            body: sectionReplies.body,
            linkUrl: sectionReplies.linkUrl,
            authorName: memberships.name,
            authorEmail: memberships.email,
            addedAfterDelivery: sectionReplies.addedAfterDelivery,
          })
          .from(sectionReplies)
          .innerJoin(memberships, eq(memberships.id, sectionReplies.membershipId))
          .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted")))
      : [];

    if (rows.length === 0 && sectionReplyRows.length === 0) {
      await skipIssue({ issue, group, at });
      skipped += 1;
      continue;
    }

    const answers: AnswerBlock[] = rows.map((row) => ({
      question: row.question,
      author: row.authorName ?? row.authorEmail.split("@")[0],
      body: row.kind === "poll" ? pollEmailChoice(row) : row.body,
      pollResults: row.kind === "poll" ? pollEmailResults(row, rows) : null,
      photoUrl: row.photoUrl,
      audioUrl: row.audioUrl,
      audioDurationMs: row.audioDurationMs,
      addedLater: row.addedAfterDelivery,
    }));

    const sectionMediaCounts = new Map<string, number>();
    if (sectionReplyRows.length > 0) {
      const mediaRows = await db
        .select({ sectionReplyId: sectionMedia.sectionReplyId })
        .from(sectionMedia)
        .where(inArray(sectionMedia.sectionReplyId, sectionReplyRows.map((row) => row.replyId)));
      for (const row of mediaRows) {
        sectionMediaCounts.set(row.sectionReplyId, (sectionMediaCounts.get(row.sectionReplyId) ?? 0) + 1);
      }
    }
    const sections = sectionRows.map((section) => ({
      title: section.title,
      emoji: section.emoji,
      answers: sectionReplyRows
        .filter((row) => row.issueSectionId === section.id)
        .map((row) => ({
          author: row.authorName ?? row.authorEmail.split("@")[0],
          body: row.body,
          linkUrl: row.linkUrl,
          addedLater: row.addedAfterDelivery,
          photoCount: row.replyId ? sectionMediaCounts.get(row.replyId) ?? 0 : 0,
        })),
    }));

    let shareToken = issue.shareToken;
    if (group.shareEnabled && !shareToken) {
      shareToken = newToken();
      await db.update(issues).set({ shareToken }).where(eq(issues.id, issue.id));
    }

    const everyone = await db
      .select({
        id: memberships.id,
        email: memberships.email,
        name: memberships.name,
        replyToken: memberships.replyToken,
        unsubscribeToken: memberships.unsubscribeToken,
      })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt)));

    for (const member of everyone) {
      // Rendered per member: the issue link and the "stop emails" link are theirs.
      const rendered = deliveryEmail({
        groupName: group.name,
        issueNumber: issue.number,
        issueName: issue.name,
        url: issueUrl(issue.id, member.replyToken),
        answers,
        sections,
        shareUrl: shareToken ? url(`/s/${shareToken}`) : null,
        theme: emailThemeOf(group),
        unsubscribeUrl: unsubscribeUrl(member.unsubscribeToken),
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

    // Conditional: whichever trigger gets here first wins, the other is a no-op.
    // Counting only the winner keeps the report honest under two triggers; the
    // emails above are deduped by `delivery:${issue.id}:${member.id}` either way.
    const claimed = await db
      .update(issues)
      .set({ status: "delivered", deliveredAt: at })
      .where(and(eq(issues.id, issue.id), eq(issues.status, "open")))
      .returning({ id: issues.id });
    if (claimed.length > 0) delivered += 1;
  }

  return { delivered, skipped };
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

async function skipIssue(input: {
  issue: typeof issues.$inferSelect;
  group: typeof groups.$inferSelect;
  at: Date;
}): Promise<void> {
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

async function remindStragglers(at: Date): Promise<number> {
  const window = await db
    .select()
    .from(issues)
    .where(
      and(
        eq(issues.status, "open"),
        sql`${issues.deliversAt} > ${at.toISOString()}`,
        sql`${issues.deliversAt} <= ${new Date(at.getTime() + REMINDER_LEADS_MS[0]).toISOString()}`,
      ),
    );

  let reminded = 0;

  for (const issue of window) {
    const [group] = await db.select().from(groups).where(eq(groups.id, issue.groupId)).limit(1);
    if (!group) continue;

    const pending = await db
      .select({
        id: memberships.id,
        email: memberships.email,
        name: memberships.name,
        replyToken: memberships.replyToken,
        unsubscribeToken: memberships.unsubscribeToken,
        timezone: users.timezone,
        reminderPreference: memberships.reminderPreference,
      })
      .from(memberships)
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.groupId, group.id),
          eq(memberships.participation, "contributor"),
          isNull(memberships.revokedAt),
        ),
      );

    const submitted = await db
      .select({ membershipId: replies.membershipId })
      .from(replies)
      .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")));
    const done = new Set(submitted.map((row) => row.membershipId));

    const totalQuestions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, issue.id));
    const questionCount = totalQuestions[0]?.count ?? 0;

    for (const member of pending) {
      if (done.has(member.id) || questionCount === 0) continue;
      // The loop sends one reminder, so it is both the first and the last. Only
      // the contributor's own "none" holds it back — the owner's nudge never asks.
      if (!wantsReminder(member.reminderPreference, 0, REMINDER_LEADS_MS.length)) continue;
      const deadline = describeDeadline(issue.deliversAt, group.timezone, member.timezone);
      const rendered = reminderEmail({
        groupName: group.name,
        memberName: member.name ?? member.email.split("@")[0],
        url: replyUrl(member.replyToken),
        deadlineLabel: deadline.inLoopZone,
        remaining: questionCount,
        theme: emailThemeOf(group),
        unsubscribeUrl: unsubscribeUrl(member.unsubscribeToken),
      });
      const result = await sendEmail({
        ...rendered,
        to: member.email,
        kind: "reminder",
        dedupeKey: `reminder:${issue.id}:${member.id}`,
        groupId: group.id,
        issueId: issue.id,
        membershipId: member.id,
        fromName: group.displayName ?? group.name,
        unsubscribeToken: member.unsubscribeToken,
      });
      if (result.queued) reminded += 1;
    }
  }

  return reminded;
}

/** Used by the probe endpoint: which loops would act at this instant. */
export async function pendingWork(at: Date) {
  const active = await db.select().from(groups).where(isNull(groups.pausedAt));
  const due = active
    .map((group) => ({ group, slot: dueSlot(groupSchedule(group), at) }))
    .filter((row): row is { group: typeof groups.$inferSelect; slot: Date } => row.slot !== null);

  const openIssues = await db
    .select({ id: issues.id })
    .from(issues)
    .where(inArray(issues.status, ["open"]));

  return { loops: active.length, dueSlots: due.length, openIssues: openIssues.length };
}

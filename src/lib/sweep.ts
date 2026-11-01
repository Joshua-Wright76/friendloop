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
import { deliveryInstant, describeDeadline, dueSlot, type LoopSchedule } from "./schedule";
import { sendEmail, flushOutbox } from "./email/send";
import { sendPromptEmails } from "./notify";
import { deliveryEmail, reminderEmail, pausedEmail, type AnswerBlock } from "./email/templates";
import { issueUrl, replyUrl, url } from "./urls";
import { newToken } from "./tokens";
import { snapshotQuestionsForIssue } from "./round-questions";

export type SweepReport = {
  opened: number;
  delivered: number;
  skipped: number;
  reminded: number;
  retried: number;
};

const REMINDER_LEAD_MS = 48 * 60 * 60 * 1000;

function scheduleOf(group: typeof groups.$inferSelect): LoopSchedule {
  return {
    timezone: group.timezone,
    promptWeekday: group.promptWeekday,
    promptHour: group.promptHour,
    cadenceWeeks: group.cadenceWeeks,
    windowDays: group.windowDays,
    createdAt: group.createdAt,
    lastSlotAt: group.lastSlotAt,
  };
}

/**
 * Reconcile the world at `at`. Safe to run at any frequency, from any number of
 * triggers, in any order: every step is idempotent through a unique constraint.
 */
export async function sweep({ at }: { at: Date }): Promise<SweepReport> {
  const report: SweepReport = { opened: 0, delivered: 0, skipped: 0, reminded: 0, retried: 0 };

  report.opened = await openDueIssues(at);
  const delivery = await deliverDueIssues(at);
  report.delivered = delivery.delivered;
  report.skipped = delivery.skipped;
  report.reminded = await remindStragglers(at);
  report.retried = await flushOutbox();
  return report;
}

async function openDueIssues(at: Date): Promise<number> {
  const active = await db.select().from(groups).where(isNull(groups.pausedAt));
  let opened = 0;

  for (const group of active) {
    const slot = dueSlot(scheduleOf(group), at);
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

    const rows = await db
      .select({
        question: issueQuestions.text,
        position: issueQuestions.position,
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

    if (rows.length === 0) {
      await skipIssue({ issue, group, at });
      skipped += 1;
      continue;
    }

    const answers: AnswerBlock[] = rows.map((row) => ({
      question: row.question,
      author: row.authorName ?? row.authorEmail.split("@")[0],
      body: row.body,
      photoUrl: row.photoUrl,
      audioUrl: row.audioUrl,
      audioDurationMs: row.audioDurationMs,
      addedLater: row.addedAfterDelivery,
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
      })
      .from(memberships)
      .where(and(eq(memberships.groupId, group.id), isNull(memberships.revokedAt)));

    const rendered = deliveryEmail({
      groupName: group.name,
      issueNumber: issue.number,
      url: issueUrl(issue.id),
      answers,
      shareUrl: shareToken ? url(`/s/${shareToken}`) : null,
    });

    for (const member of everyone) {
      await sendEmail({
        ...rendered,
        html: rendered.html.replaceAll(issueUrl(issue.id), issueUrl(issue.id, member.replyToken)),
        text: rendered.text.replaceAll(issueUrl(issue.id), issueUrl(issue.id, member.replyToken)),
        to: member.email,
        kind: "delivery",
        dedupeKey: `delivery:${issue.id}:${member.id}`,
        groupId: group.id,
        issueId: issue.id,
        membershipId: member.id,
        fromName: group.displayName ?? group.name,
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
    .select({ id: memberships.id, email: memberships.email })
    .from(memberships)
    .where(and(eq(memberships.groupId, group.id), eq(memberships.access, "owner")));

  for (const owner of owners) {
    const rendered = pausedEmail({ groupName: group.name, url: url(`/g/${group.id}`) });
    await sendEmail({
      ...rendered,
      to: owner.email,
      kind: "nudge",
      dedupeKey: `skipped:${issue.id}:${owner.id}`,
      groupId: group.id,
      issueId: issue.id,
      membershipId: owner.id,
      fromName: group.displayName ?? group.name,
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
        sql`${issues.deliversAt} <= ${new Date(at.getTime() + REMINDER_LEAD_MS).toISOString()}`,
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
        timezone: users.timezone,
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
      const deadline = describeDeadline(issue.deliversAt, group.timezone, member.timezone);
      const rendered = reminderEmail({
        groupName: group.name,
        memberName: member.name ?? member.email.split("@")[0],
        url: replyUrl(member.replyToken),
        deadlineLabel: deadline.inLoopZone,
        remaining: questionCount,
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
    .map((group) => ({ group, slot: dueSlot(scheduleOf(group), at) }))
    .filter((row): row is { group: typeof groups.$inferSelect; slot: Date } => row.slot !== null);

  const openIssues = await db
    .select({ id: issues.id })
    .from(issues)
    .where(inArray(issues.status, ["open"]));

  return { loops: active.length, dueSlots: due.length, openIssues: openIssues.length };
}

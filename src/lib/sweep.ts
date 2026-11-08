import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, replies, users } from "@/db/schema";
import { flushOutbox, sendEmail } from "./email/send";
import { mailDeadline } from "./notify";
import { emailThemeOf, reminderEmail } from "./email/templates";
import { REMINDER_LEADS_MS, wantsReminder } from "./reminders";
import { replyUrl, unsubscribeUrl } from "./urls";
import { purgeQueuedMedia } from "./media-cleanup.ts";
import { pruneRateLimits } from "./rate-limit";
import { deliverRound, openRound } from "./rounds";

export type SweepReport = {
  opened: number;
  delivered: number;
  /** Empty rounds moved on to the next delivery. */
  carried: number;
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
  return { opened: 0, delivered: 0, carried: 0, skipped: 0, reminded: 0, retried: 0, mediaPurged: 0, busy };
}

async function sweepUnlocked(at: Date): Promise<SweepReport> {
  const report = emptyReport(false);

  // Delivery opens each next round itself; the second step only catches a loop
  // left without one (an interrupted run, or a loop from before rounds ran back
  // to back).
  const delivery = await deliverDueIssues(at);
  report.delivered = delivery.delivered;
  report.carried = delivery.carried;
  report.skipped = delivery.skipped;
  // Every delivery opens the round after it, so those count as opened too.
  report.opened = delivery.delivered + (await openMissingRounds(at));
  report.reminded = await remindStragglers(at);
  report.retried = await flushOutbox();
  report.mediaPurged = await purgeQueuedMedia();
  // Housekeeping, not part of the report: closed abuse windows are just rows.
  await pruneRateLimits(at);
  return report;
}

/** Every running loop has a round open; open one, with its prompt emails, where it doesn't. */
async function openMissingRounds(at: Date): Promise<number> {
  const missing = await loopsWithoutRound();
  let opened = 0;
  for (const group of missing) {
    const round = await openRound({ groupId: group.id, at, prompt: true });
    if (round?.created) opened += 1;
  }
  return opened;
}

async function loopsWithoutRound() {
  return db
    .select({ id: groups.id })
    .from(groups)
    .where(and(
      isNull(groups.pausedAt),
      sql`not exists (select 1 from ${issues} where ${issues.groupId} = ${groups.id} and ${issues.status} = 'open')`,
    ));
}

/** Rounds whose delivery has come, in loops that aren't paused: a pause holds its round. */
async function deliverDueIssues(at: Date): Promise<{ delivered: number; carried: number; skipped: number }> {
  const due = await db
    .select({ issue: issues })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(and(eq(issues.status, "open"), isNull(groups.pausedAt), sql`${issues.deliversAt} <= ${at.toISOString()}`));

  const counts = { delivered: 0, carried: 0, skipped: 0 };
  for (const { issue } of due) {
    const outcome = await deliverRound({ issue, at });
    if (outcome === "delivered") counts.delivered += 1;
    if (outcome === "carried") counts.carried += 1;
    if (outcome === "skipped") counts.skipped += 1;
  }
  return counts;
}

async function remindStragglers(at: Date): Promise<number> {
  const lead = REMINDER_LEADS_MS[0];
  const window = await db
    .select({ issue: issues })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(
      and(
        eq(issues.status, "open"),
        isNull(groups.pausedAt),
        sql`${issues.deliversAt} > ${at.toISOString()}`,
        sql`${issues.deliversAt} <= ${new Date(at.getTime() + lead).toISOString()}`,
        // A round that opened this close to its delivery has only just emailed its
        // questions; a reminder on top of them would be noise.
        sql`${issues.opensAt} <= ${issues.deliversAt} - make_interval(secs => ${lead / 1000})`,
      ),
    );

  let reminded = 0;

  for (const { issue } of window) {
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
      const rendered = reminderEmail({
        groupName: group.name,
        memberName: member.name ?? member.email.split("@")[0],
        url: replyUrl(member.replyToken),
        deadlineLabel: mailDeadline(issue.deliversAt, group.timezone, member.timezone),
        remaining: questionCount,
        theme: emailThemeOf(group),
        unsubscribeUrl: unsubscribeUrl(member.unsubscribeToken),
      });
      const result = await sendEmail({
        ...rendered,
        to: member.email,
        kind: "reminder",
        // A round carried over to a later delivery earns one more reminder before it.
        dedupeKey: issue.deliversAt.getTime() === issue.slotAt.getTime()
          ? `reminder:${issue.id}:${member.id}`
          : `reminder:${issue.id}:${member.id}:${issue.deliversAt.getTime()}`,
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
  const active = await db.select({ id: groups.id }).from(groups).where(isNull(groups.pausedAt));
  const missing = await loopsWithoutRound();
  const openIssues = await db
    .select({ id: issues.id, deliversAt: issues.deliversAt })
    .from(issues)
    .where(inArray(issues.status, ["open"]));
  const due = openIssues.filter((issue) => issue.deliversAt.getTime() <= at.getTime());

  return { loops: active.length, dueSlots: missing.length + due.length, openIssues: openIssues.length };
}

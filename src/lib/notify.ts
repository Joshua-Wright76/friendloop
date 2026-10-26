import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, outbox, replies, users } from "@/db/schema";
import { describeDeadline } from "./schedule";
import { sendEmail } from "./email/send";
import { promptEmail, reminderEmail } from "./email/templates";
import { replyUrl } from "./urls";

/** One prompt per contributor for a round that just opened. */
export async function sendPromptEmails(input: {
  group: typeof groups.$inferSelect;
  issueId: string;
  issueNumber: number;
  deliversAt: Date;
  questionCount: number;
}): Promise<number> {
  const { group, issueId, issueNumber, deliversAt, questionCount } = input;
  if (questionCount === 0) return 0;

  const recipients = await db
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

  let sent = 0;
  for (const recipient of recipients) {
    const deadline = describeDeadline(deliversAt, group.timezone, recipient.timezone);
    const rendered = promptEmail({
      groupName: group.name,
      memberName: recipient.name ?? recipient.email.split("@")[0],
      issueNumber,
      questionCount,
      url: replyUrl(recipient.replyToken),
      deadlineLabel: deadline.inLoopZone,
    });
    const result = await sendEmail({
      ...rendered,
      to: recipient.email,
      kind: "prompt",
      dedupeKey: `prompt:${issueId}:${recipient.id}`,
      groupId: group.id,
      issueId,
      membershipId: recipient.id,
      fromName: group.displayName ?? group.name,
    });
    if (result.queued) sent += 1;
  }
  return sent;
}

/**
 * The owner's own nudge, sent from the dashboard in the gap before the automatic
 * 48-hour reminder. Repeatable on purpose: every send gets its own dedupe key,
 * so a second click is one more gentle email rather than a duplicate.
 */
export async function nudgeStragglers(groupId: string): Promise<number> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return 0;

  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .orderBy(desc(issues.number))
    .limit(1);
  if (!issue) return 0;

  const [{ count: questionCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, issue.id));
  if (questionCount === 0) return 0;

  const submitted = await db
    .select({ membershipId: replies.membershipId })
    .from(replies)
    .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")));
  const done = new Set(submitted.map((row) => row.membershipId));

  const contributors = await db
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

  let sent = 0;
  for (const member of contributors) {
    if (done.has(member.id)) continue;

    const [previous] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outbox)
      .where(like(outbox.dedupeKey, `manual-reminder:${issue.id}:${member.id}:%`));
    const attempt = (previous?.count ?? 0) + 1;

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
      dedupeKey: `manual-reminder:${issue.id}:${member.id}:${attempt}`,
      groupId: group.id,
      issueId: issue.id,
      membershipId: member.id,
      fromName: group.displayName ?? group.name,
    });
    if (result.queued) sent += 1;
  }

  return sent;
}

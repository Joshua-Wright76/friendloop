import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { answeredMemberIds } from "./answered";
import { groups, issueQuestions, issueSections, issues, memberships, outbox, users } from "@/db/schema";
import { legacyAskCondition } from "./legacy-ask";
import { atMoment, formatMoment, timezonePlace } from "./format";
import { sendEmail } from "./email/send";
import { emailThemeOf, promptEmail, reminderEmail } from "./email/templates";
import { replyUrl, unsubscribeUrl } from "./urls";

/** One way to write a deadline in mail: on the reader's clock if we know it, else named for the loop's place. */
export function mailDeadline(instant: Date, loopTimezone: string, readerTimezone: string | null): string {
  if (readerTimezone) return `${atMoment(formatMoment(instant, readerTimezone))} your time`;
  return `${atMoment(formatMoment(instant, loopTimezone))} ${timezonePlace(loopTimezone)} time`;
}

type Access = (typeof memberships.$inferSelect)["access"];

/**
 * What a round asks, as one person sees it: its questions, then its sections
 * (an event is one too). Sections only admins answer are left out for everyone
 * else, so a member's count and list never mention them.
 */
export async function roundAsks(issueId: string): Promise<(access: Access) => string[]> {
  const [asked, carried] = await Promise.all([
    db
      .select({ text: issueQuestions.text })
      .from(issueQuestions)
      .where(and(eq(issueQuestions.issueId, issueId), legacyAskCondition()))
      .orderBy(issueQuestions.position),
    db
      .select({ title: issueSections.title, emoji: issueSections.emoji, adminOnly: issueSections.adminOnly })
      .from(issueSections)
      .where(eq(issueSections.issueId, issueId))
      .orderBy(issueSections.position),
  ]);
  return (access) => [
    ...asked.map((question) => question.text),
    ...carried
      .filter((section) => !section.adminOnly || access !== "member")
      .map((section) => (section.emoji ? `${section.emoji} ${section.title}` : section.title)),
  ];
}

/** One prompt per contributor for a round that just opened, unless it asks them nothing. */
export async function sendPromptEmails(input: {
  group: typeof groups.$inferSelect;
  issueId: string;
  issueNumber: number;
  issueName?: string | null;
  deliversAt: Date;
}): Promise<number> {
  const { group, issueId, issueNumber, issueName, deliversAt } = input;

  const recipients = await db
    .select({
      id: memberships.id,
      email: memberships.email,
      name: memberships.name,
      access: memberships.access,
      replyToken: memberships.replyToken,
      unsubscribeToken: memberships.unsubscribeToken,
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

  const asksFor = await roundAsks(issueId);

  let sent = 0;
  for (const recipient of recipients) {
    const asked = asksFor(recipient.access);
    if (asked.length === 0) continue;
    const rendered = promptEmail({
      groupName: group.name,
      memberName: recipient.name ?? recipient.email.split("@")[0],
      issueNumber,
      issueName,
      questionCount: asked.length,
      url: replyUrl(recipient.replyToken),
      deadlineLabel: mailDeadline(deliversAt, group.timezone, recipient.timezone),
      questions: asked,
      theme: emailThemeOf(group),
      unsubscribeUrl: unsubscribeUrl(recipient.unsubscribeToken),
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
      unsubscribeToken: recipient.unsubscribeToken,
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
export async function nudgeStragglers(groupId: string, fromMembershipId?: string): Promise<number> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return 0;

  const [issue] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .orderBy(desc(issues.number))
    .limit(1);
  if (!issue) return 0;

  const asksFor = await roundAsks(issue.id);

  // Anyone with something written is in; only an empty hand is reminded.
  const done = await answeredMemberIds(issue.id);

  const contributors = await db
    .select({
      id: memberships.id,
      email: memberships.email,
      name: memberships.name,
      access: memberships.access,
      replyToken: memberships.replyToken,
      unsubscribeToken: memberships.unsubscribeToken,
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
    // The person sending the nudge doesn't get one.
    if (done.has(member.id) || member.id === fromMembershipId) continue;
    const remaining = asksFor(member.access).length;
    if (remaining === 0) continue;

    const [previous] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(outbox)
      .where(like(outbox.dedupeKey, `manual-reminder:${issue.id}:${member.id}:%`));
    const attempt = (previous?.count ?? 0) + 1;

    const rendered = reminderEmail({
      groupName: group.name,
      memberName: member.name ?? member.email.split("@")[0],
      url: replyUrl(member.replyToken),
      deadlineLabel: mailDeadline(issue.deliversAt, group.timezone, member.timezone),
      remaining,
      theme: emailThemeOf(group),
      unsubscribeUrl: unsubscribeUrl(member.unsubscribeToken),
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
      unsubscribeToken: member.unsubscribeToken,
    });
    if (result.queued) sent += 1;
  }

  return sent;
}

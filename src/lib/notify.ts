import { and, desc, eq, isNull, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { answeredMemberIds } from "./answered";
import { groups, issueQuestions, issues, memberships, outbox, users } from "@/db/schema";
import { askedOf, askLabel } from "./asks";
import { atMoment, formatMoment, timezonePlace } from "./format";
import { sendEmail } from "./email/send";
import { emailThemeOf, promptEmail, reminderEmail } from "./email/templates";
import { replyUrl, unsubscribeUrl } from "./urls";

/** One way to write a deadline in mail: on the reader's clock if we know it, else named for the loop's place. */
export function mailDeadline(instant: Date, loopTimezone: string, readerTimezone: string | null): string {
  if (readerTimezone) return `${atMoment(formatMoment(instant, readerTimezone))} your time`;
  return `${atMoment(formatMoment(instant, loopTimezone))} ${timezonePlace(loopTimezone)} time`;
}

type Person = { id: string; access: (typeof memberships.$inferSelect)["access"] };

/**
 * What a round asks, as one person sees it: everything in it, in round order,
 * minus owners-only items for plain members and a birthday card for the person
 * it is about. Prompts, reminders, nudges and the next round's list in a
 * delivery email all count and list the same things.
 */
export async function roundAsks(issueId: string): Promise<(person: Person) => string[]> {
  const asked = await db
    .select({
      text: issueQuestions.text,
      emoji: issueQuestions.emoji,
      adminOnly: issueQuestions.adminOnly,
      aboutMembershipId: issueQuestions.aboutMembershipId,
    })
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, issueId))
    .orderBy(issueQuestions.position, issueQuestions.id);
  return (person) => asked.filter((row) => askedOf(row, person)).map(askLabel);
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
    const asked = asksFor(recipient);
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
    const remaining = asksFor(member).length;
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

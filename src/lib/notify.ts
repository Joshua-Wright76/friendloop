import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, memberships, users } from "@/db/schema";
import { describeDeadline } from "./schedule";
import { sendEmail } from "./email/send";
import { promptEmail } from "./email/templates";
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

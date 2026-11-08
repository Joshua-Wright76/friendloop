import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { replies, sectionReplies } from "@/db/schema";
import { replyHasContentCondition, sectionReplyHasContentCondition } from "./reply-query";
import { legacyReplyCondition } from "./legacy-ask";

/**
 * Everyone who has written something in a round: an answer to a question or to a
 * section. Nobody presses anything for it to count, so "still owes an answer"
 * means "has nothing written", which is what reminders, nudges and progress ask.
 */
export async function answeredMemberIds(issueId: string): Promise<Set<string>> {
  const [questionRows, sectionRows] = await Promise.all([
    db
      .selectDistinct({ membershipId: replies.membershipId })
      .from(replies)
      .where(and(eq(replies.issueId, issueId), replyHasContentCondition(), legacyReplyCondition())),
    db
      .selectDistinct({ membershipId: sectionReplies.membershipId })
      .from(sectionReplies)
      .where(and(eq(sectionReplies.issueId, issueId), sectionReplyHasContentCondition())),
  ]);
  return new Set([...questionRows, ...sectionRows].map((row) => row.membershipId));
}

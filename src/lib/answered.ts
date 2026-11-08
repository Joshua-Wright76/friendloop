import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { replies } from "@/db/schema";
import { replyHasContentCondition } from "./reply-query";

/**
 * Everyone who has written something in a round, in any of its items. Nobody
 * presses anything for it to count, so "still owes an answer" means "has nothing
 * written", which is what reminders, nudges and progress ask.
 */
export async function answeredMemberIds(issueId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ membershipId: replies.membershipId })
    .from(replies)
    .where(and(eq(replies.issueId, issueId), replyHasContentCondition()));
  return new Set(rows.map((row) => row.membershipId));
}

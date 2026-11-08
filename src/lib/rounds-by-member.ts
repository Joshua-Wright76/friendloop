import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { replyHasContentCondition } from "./reply-query";
import { issueQuestions, issues, replies } from "@/db/schema";

export { parseMemberFilter } from "./member-filter.ts";

/**
 * The delivered rounds a person put an answer in, of any kind, except in items
 * only owners and admins may read, which a plain member has no business learning
 * someone wrote in.
 */
export async function deliveredRoundsAnsweredBy(input: {
  groupId: string;
  membershipId: string;
  includeAdminOnly: boolean;
}): Promise<Set<string>> {
  const everyone = await deliveredRoundsAnsweredByEveryone(input);
  return new Set(everyone.get(input.membershipId.toLowerCase()) ?? []);
}

/**
 * The same, for every member at once, keyed by membership id: one round trip,
 * small enough to send with the loop so the rounds list filters in the browser.
 */
export async function deliveredRoundsAnsweredByEveryone(input: {
  groupId: string;
  includeAdminOnly: boolean;
}): Promise<Map<string, string[]>> {
  const delivered = and(eq(issues.groupId, input.groupId), eq(issues.status, "delivered"));
  const rows = await db
    .selectDistinct({ issueId: replies.issueId, membershipId: replies.membershipId, adminOnly: issueQuestions.adminOnly })
    .from(replies)
    .innerJoin(issues, eq(issues.id, replies.issueId))
    .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
    .where(and(delivered, replyHasContentCondition()));

  const byMember = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.adminOnly && !input.includeAdminOnly) continue;
    const key = row.membershipId.toLowerCase();
    if (!byMember.has(key)) byMember.set(key, new Set());
    byMember.get(key)!.add(row.issueId);
  }
  return new Map([...byMember].map(([key, ids]) => [key, [...ids]]));
}

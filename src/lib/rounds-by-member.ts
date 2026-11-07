import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { issueQuestions, issueSections, issues, replies, sectionReplies } from "@/db/schema";

export { parseMemberFilter } from "./member-filter.ts";

/**
 * The delivered rounds a person put an answer in: a written or poll answer, or a
 * section answer — except in sections only admins may read, which a plain member
 * has no business learning someone wrote in.
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
  const [questionRows, sectionRows] = await Promise.all([
    db
      .selectDistinct({ issueId: replies.issueId, membershipId: replies.membershipId })
      .from(replies)
      .innerJoin(issues, eq(issues.id, replies.issueId))
      .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
      .where(
        and(
          delivered,
          eq(replies.status, "submitted"),
          // A poll pick cleared after sending is not an answer.
          sql`(${issueQuestions.kind} <> 'poll' or jsonb_array_length(${replies.pollChoices}) > 0)`,
        ),
      ),
    db
      .selectDistinct({ issueId: sectionReplies.issueId, membershipId: sectionReplies.membershipId, adminOnly: issueSections.adminOnly })
      .from(sectionReplies)
      .innerJoin(issues, eq(issues.id, sectionReplies.issueId))
      .innerJoin(issueSections, eq(issueSections.id, sectionReplies.issueSectionId))
      .where(and(delivered, eq(sectionReplies.status, "submitted"))),
  ]);

  const byMember = new Map<string, Set<string>>();
  const add = (membershipId: string, issueId: string) => {
    const key = membershipId.toLowerCase();
    if (!byMember.has(key)) byMember.set(key, new Set());
    byMember.get(key)!.add(issueId);
  };
  for (const row of questionRows) add(row.membershipId, row.issueId);
  for (const row of sectionRows) if (input.includeAdminOnly || !row.adminOnly) add(row.membershipId, row.issueId);
  return new Map([...byMember].map(([key, ids]) => [key, [...ids]]));
}

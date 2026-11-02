import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { issueQuestions, issueSections, issues, replies, sectionReplies } from "@/db/schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?member=` in the rounds list: a membership id, or nothing. */
export function parseMemberFilter(value: string | string[] | undefined): string | null {
  const raw = (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  return UUID.test(raw) ? raw.toLowerCase() : null;
}

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
  const delivered = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, input.groupId), eq(issues.status, "delivered")));
  const ids = delivered.map((row) => row.id);
  if (ids.length === 0) return new Set();

  const [questionRows, sectionRows] = await Promise.all([
    db
      .selectDistinct({ issueId: replies.issueId })
      .from(replies)
      .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
      .where(
        and(
          inArray(replies.issueId, ids),
          eq(replies.membershipId, input.membershipId),
          eq(replies.status, "submitted"),
          // A poll pick cleared after sending is not an answer.
          sql`(${issueQuestions.kind} <> 'poll' or jsonb_array_length(${replies.pollChoices}) > 0)`,
        ),
      ),
    db
      .selectDistinct({ issueId: sectionReplies.issueId, adminOnly: issueSections.adminOnly })
      .from(sectionReplies)
      .innerJoin(issueSections, eq(issueSections.id, sectionReplies.issueSectionId))
      .where(
        and(
          inArray(sectionReplies.issueId, ids),
          eq(sectionReplies.membershipId, input.membershipId),
          eq(sectionReplies.status, "submitted"),
        ),
      ),
  ]);

  return new Set([
    ...questionRows.map((row) => row.issueId),
    ...sectionRows.filter((row) => input.includeAdminOnly || !row.adminOnly).map((row) => row.issueId),
  ]);
}

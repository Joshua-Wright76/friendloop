import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, questions, replies } from "@/db/schema";
import { selectRoundQuestions } from "./question-rotation";
import { suggestionCreditsForQuestions } from "./suggestions";
import { legacyAskCondition, legacyPoolCondition } from "./legacy-ask";

type QuestionRow = typeof questions.$inferSelect;

async function activePool(groupId: string): Promise<QuestionRow[]> {
  return db
    .select()
    .from(questions)
    .where(and(eq(questions.groupId, groupId), legacyPoolCondition(), isNull(questions.archivedAt)))
    .orderBy(questions.position);
}

async function snapshotRows(groupId: string, issueId: string, selected: QuestionRow[], positions: number[]) {
  if (selected.length === 0) return;
  const credits = await suggestionCreditsForQuestions(groupId, selected.map((question) => question.id));
  await db
    .insert(issueQuestions)
    .values(
      selected.map((question, index) => ({
        issueId,
        questionId: question.id,
        text: question.text,
        position: positions[index],
        suggestedBy: credits.get(question.id) ?? null,
        kind: question.kind,
        pollMultiple: question.pollMultiple,
        pollOptions: question.pollOptions,
      })),
    )
    .onConflictDoNothing({ target: [issueQuestions.issueId, issueQuestions.questionId] });
}

/**
 * Snapshot a freshly opened round's questions, starting the rotation at `cursor`,
 * and advance the loop's cursor past them.
 */
export async function snapshotQuestionsForIssue(input: {
  group: typeof groups.$inferSelect;
  issueId: string;
  cursor?: number;
}): Promise<number> {
  const { group, issueId } = input;
  const pool = await activePool(group.id);
  const { selected, nextCursor } = selectRoundQuestions(pool, group.questionsPerRound, input.cursor ?? group.questionCursor);
  await snapshotRows(group.id, issueId, selected, selected.map((_, index) => index));
  await db.update(groups).set({ questionCursor: nextCursor }).where(eq(groups.id, group.id));
  return selected.length;
}

/**
 * Keep the open round in step with the question pool. A round is open from one
 * delivery to the next, so an owner adding, ordering, skipping or archiving a
 * question means it for the round people are answering now.
 *
 * The selection is re-run from the cursor the round opened with. Questions it
 * now picks are added; questions it no longer picks are taken out only if nobody
 * has started an answer to them, so no one's writing ever disappears.
 */
export async function syncOpenRoundQuestions(groupId: string): Promise<void> {
  const [row] = await db
    .select({ group: groups, issue: issues })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open")))
    .limit(1);
  if (!row) return;
  const { group, issue } = row;

  const pool = await activePool(groupId);
  const { selected, nextCursor } = selectRoundQuestions(pool, group.questionsPerRound, issue.questionCursor ?? 0);
  const wanted = new Map(selected.map((question, index) => [question.id, index]));

  const current = await db
    .select({ id: issueQuestions.id, questionId: issueQuestions.questionId, position: issueQuestions.position })
    .from(issueQuestions)
    .where(and(eq(issueQuestions.issueId, issue.id), legacyAskCondition()))
    .orderBy(asc(issueQuestions.position));
  const started = new Set(
    current.length === 0
      ? []
      : (
          await db
            .selectDistinct({ id: replies.issueQuestionId })
            .from(replies)
            .where(and(eq(replies.issueId, issue.id), inArray(replies.issueQuestionId, current.map((question) => question.id))))
        ).map((reply) => reply.id),
  );

  const dropped = current.filter((question) => !(question.questionId && wanted.has(question.questionId)) && !started.has(question.id));
  if (dropped.length > 0) {
    await db.delete(issueQuestions).where(inArray(issueQuestions.id, dropped.map((question) => question.id)));
  }

  const have = new Set(current.map((question) => question.questionId));
  const added = selected.filter((question) => !have.has(question.id));
  await snapshotRows(groupId, issue.id, added, added.map((question) => wanted.get(question.id) ?? 0));

  // Pool order, with anything kept only for its answers after the rest.
  const kept = current.filter((question) => !dropped.includes(question));
  const extra = kept.filter((question) => !(question.questionId && wanted.has(question.questionId)));
  const positions = [
    ...kept
      .filter((question) => question.questionId && wanted.has(question.questionId))
      .map((question) => ({ id: question.id, position: wanted.get(question.questionId!)!, was: question.position })),
    ...extra.map((question, index) => ({ id: question.id, position: selected.length + index, was: question.position })),
  ].filter((question) => question.position !== question.was);
  if (positions.length > 0) {
    const cases = positions.map((question) => sql`when ${question.id}::uuid then ${question.position}::int`);
    await db
      .update(issueQuestions)
      .set({ position: sql`case ${issueQuestions.id} ${sql.join(cases, sql` `)} else ${issueQuestions.position} end` })
      .where(inArray(issueQuestions.id, positions.map((question) => question.id)));
  }

  if (group.questionCursor !== nextCursor) {
    await db.update(groups).set({ questionCursor: nextCursor }).where(eq(groups.id, groupId));
  }
}

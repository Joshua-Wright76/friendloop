import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, questions } from "@/db/schema";
import { selectRoundQuestions } from "./question-rotation";

/** Snapshot one round and advance the cursor used by both scheduled and manual sends. */
export async function snapshotQuestionsForIssue(input: {
  group: typeof groups.$inferSelect;
  issueId: string;
}): Promise<number> {
  const { group, issueId } = input;
  const pool = await db
    .select()
    .from(questions)
    .where(and(eq(questions.groupId, group.id), eq(questions.active, true), isNull(questions.archivedAt)))
    .orderBy(questions.position);

  const { selected, nextCursor } = selectRoundQuestions(pool, group.questionsPerRound, group.questionCursor);
  if (selected.length > 0) {
    await db.insert(issueQuestions).values(
      selected.map((question, index) => ({
        issueId,
        questionId: question.id,
        text: question.text,
        position: index,
      })),
    );
  }

  await db.update(groups).set({ questionCursor: nextCursor }).where(eq(groups.id, group.id));

  // "Skip next round" only ever skips one round.
  await db
    .update(questions)
    .set({ skipNext: false })
    .where(and(eq(questions.groupId, group.id), eq(questions.skipNext, true)));

  return selected.length;
}

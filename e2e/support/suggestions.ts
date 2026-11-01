import { db } from "@/db";
import { memberships, questionSuggestions, questions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { SeededLoop } from "./seed";

/**
 * Insert a suggestion as a fixture. Accepted ones point at the pool question
 * they became, so the issue snapshot picks up their credit; pending ones are
 * waiting in the owner's queue.
 */
export async function seedSuggestion(input: {
  loop: SeededLoop;
  questionText: string;
  memberEmail: string;
  authorDisplay?: "name" | "anonymous";
  status?: "pending" | "accepted";
}): Promise<void> {
  const status = input.status ?? "accepted";

  let acceptedQuestionId: string | undefined;
  if (status === "accepted") {
    const [question] = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.groupId, input.loop.groupId), eq(questions.text, input.questionText)))
      .limit(1);
    if (!question) throw new Error(`No question ${input.questionText}`);
    acceptedQuestionId = question.id;
  }

  const [membership] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(eq(memberships.groupId, input.loop.groupId), eq(memberships.email, input.memberEmail)))
    .limit(1);
  if (!membership) throw new Error(`No member ${input.memberEmail}`);

  await db.insert(questionSuggestions).values({
    groupId: input.loop.groupId,
    membershipId: membership.id,
    text: input.questionText,
    authorDisplay: input.authorDisplay ?? "name",
    status,
    acceptedQuestionId,
  });
}

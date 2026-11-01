import { db } from "@/db";
import { issueQuestions, questions, replies } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { SeededLoop } from "./seed";

/** Put a poll in the loop's pool, as the owner's form would, without the UI. */
export async function seedPoll(
  loop: SeededLoop,
  input: { text: string; options: string[]; multiple?: boolean },
): Promise<string> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${questions.position}), -1)::int + 1` })
    .from(questions)
    .where(eq(questions.groupId, loop.groupId));
  const [row] = await db
    .insert(questions)
    .values({
      groupId: loop.groupId,
      text: input.text,
      position: next,
      kind: "poll",
      pollMultiple: input.multiple ?? false,
      pollOptions: input.options,
    })
    .returning({ id: questions.id });
  return row.id;
}

/** A submitted pick on an issue's poll, straight into the database. */
export async function seedPollVote(issueId: string, membershipId: string, choices: number[]): Promise<void> {
  const [poll] = await db
    .select({ id: issueQuestions.id })
    .from(issueQuestions)
    .where(and(eq(issueQuestions.issueId, issueId), eq(issueQuestions.kind, "poll")))
    .limit(1);
  if (!poll) throw new Error(`No poll on issue ${issueId}`);
  await db.insert(replies).values({
    issueId,
    issueQuestionId: poll.id,
    membershipId,
    pollChoices: choices,
    status: "submitted",
    submittedAt: new Date("2026-10-30T08:00:00Z"),
  });
}

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, questionSuggestions } from "@/db/schema";
import { resolveToken } from "./reply";
import { copy } from "./copy.ts";
import { SUGGESTION_MAX_LENGTH, suggestionCredit, type AuthorDisplay } from "./suggestion-credit";

export { SUGGESTION_MAX_LENGTH, suggestionCredit };
export type { AuthorDisplay };

export type SuggestionWriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * Store a contributor's question suggestion. Web-only by design: no email, no
 * prompt copy — the affordance lives on the reply sheet.
 */
export async function createSuggestion(input: {
  token: string;
  text: string;
  authorDisplay: AuthorDisplay;
}): Promise<SuggestionWriteResult> {
  const text = input.text.trim();
  if (!text || text.length > SUGGESTION_MAX_LENGTH) {
    return { ok: false, status: 400, error: copy.suggest.errors.text };
  }
  if (input.authorDisplay !== "name" && input.authorDisplay !== "anonymous") {
    return { ok: false, status: 400, error: copy.suggest.errors.authorDisplay };
  }

  const context = await resolveToken(input.token);
  if (context.state === "invalid") {
    return { ok: false, status: 404, error: copy.suggest.errors.invalidLink };
  }
  if (context.state === "reader") {
    return { ok: false, status: 403, error: copy.suggest.errors.reader };
  }

  await db.insert(questionSuggestions).values({
    groupId: context.group.id,
    membershipId: context.membership.id,
    text,
    authorDisplay: input.authorDisplay,
  });
  return { ok: true };
}

/** Pending suggestions for the owner's review queue, oldest first. */
export async function pendingSuggestions(groupId: string) {
  return db
    .select({
      id: questionSuggestions.id,
      text: questionSuggestions.text,
      authorDisplay: questionSuggestions.authorDisplay,
      authorName: memberships.name,
      authorEmail: memberships.email,
      createdAt: questionSuggestions.createdAt,
    })
    .from(questionSuggestions)
    .innerJoin(memberships, eq(memberships.id, questionSuggestions.membershipId))
    .where(and(eq(questionSuggestions.groupId, groupId), eq(questionSuggestions.status, "pending")))
    .orderBy(desc(questionSuggestions.createdAt));
}

export type SuggestionDecision =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Turn a suggestion into a pool question attributed to its author. The text may
 * have been edited by the owner before accepting.
 */
export async function acceptSuggestion(input: {
  groupId: string;
  suggestionId: string;
  text: string;
  at: Date;
}): Promise<SuggestionDecision> {
  const text = input.text.trim();
  if (!text || text.length > SUGGESTION_MAX_LENGTH) {
    return { ok: false, error: copy.suggest.errors.text };
  }

  const [suggestion] = await db
    .select()
    .from(questionSuggestions)
    .where(and(eq(questionSuggestions.id, input.suggestionId), eq(questionSuggestions.groupId, input.groupId)))
    .limit(1);
  if (!suggestion || suggestion.status !== "pending") {
    return { ok: false, error: copy.suggest.errors.notPending };
  }

  // Imported here: round-questions reads suggestion credits from this module.
  const { addToOpenRound, insertPoolItem, newQuestionFrequency } = await import("./round-questions");
  const frequency = await newQuestionFrequency(input.groupId);
  const questionId = await insertPoolItem({
    groupId: input.groupId,
    text,
    format: "written",
    frequency,
    createdByMembershipId: suggestion.membershipId,
    at: input.at,
  });

  await db
    .update(questionSuggestions)
    .set({ status: "accepted", acceptedQuestionId: questionId, decidedAt: input.at })
    .where(eq(questionSuggestions.id, suggestion.id));

  // Credited from here on. Asked every round, it joins the round open now, as any
  // every-round item does; taking turns, it waits at the back of the queue.
  if (frequency === "every_round") await addToOpenRound(input.groupId, questionId);

  return { ok: true };
}

/** Turn a suggestion down without ceremony; the queue simply loses it. */
export async function declineSuggestion(input: {
  groupId: string;
  suggestionId: string;
  at: Date;
}): Promise<SuggestionDecision> {
  const [suggestion] = await db
    .select({ id: questionSuggestions.id, status: questionSuggestions.status })
    .from(questionSuggestions)
    .where(and(eq(questionSuggestions.id, input.suggestionId), eq(questionSuggestions.groupId, input.groupId)))
    .limit(1);
  if (!suggestion || suggestion.status !== "pending") {
    return { ok: false, error: copy.suggest.errors.notPending };
  }

  await db
    .update(questionSuggestions)
    .set({ status: "declined", decidedAt: input.at })
    .where(eq(questionSuggestions.id, suggestion.id));
  return { ok: true };
}

/**
 * The credit each selected question carries into an issue snapshot: the
 * author's display name, or null when they chose anonymity. Frozen at open so
 * later profile edits never rewrite a delivered issue.
 */
export async function suggestionCreditsForQuestions(
  groupId: string,
  questionIds: string[],
): Promise<Map<string, string>> {
  if (questionIds.length === 0) return new Map();

  const rows = await db
    .select({
      questionId: questionSuggestions.acceptedQuestionId,
      authorDisplay: questionSuggestions.authorDisplay,
      authorName: memberships.name,
      authorEmail: memberships.email,
    })
    .from(questionSuggestions)
    .innerJoin(memberships, eq(memberships.id, questionSuggestions.membershipId))
    .where(eq(questionSuggestions.groupId, groupId));

  const credits = new Map<string, string>();
  for (const row of rows) {
    if (!row.questionId || !questionIds.includes(row.questionId)) continue;
    const fallback = row.authorName ?? row.authorEmail.split("@")[0];
    const credit = suggestionCredit(row.authorDisplay, fallback);
    if (credit) credits.set(row.questionId, credit);
  }
  return credits;
}

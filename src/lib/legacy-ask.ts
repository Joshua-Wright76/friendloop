import { and, eq, inArray, isNotNull, not, or, sql, type SQL } from "drizzle-orm";
import { issueQuestions, questions, replies } from "../db/schema.ts";

/*
 * Tolerate rule, until questions and sections are one list
 * (`docs/questions-unify-design.md`, PR A).
 *
 * The next release copies sections, events and their answers into `questions`,
 * `issue_questions` and `replies`, keeping their ids. This code doesn't know
 * those rows: it would show a section's answers twice, count them as question
 * answers, and its open-round sync would delete them. So every read here of a
 * round's questions or answers asks only for what this code wrote itself: a
 * written or poll question that didn't come from a section. A read keyed by ids
 * that already passed the rule is covered by it.
 *
 * Reads that ask "is this file still used?" or "which files does this person
 * leave behind?" look at every row on purpose: a copied answer can point at a
 * section's photo, and that file must not be deleted while it does.
 */

const LEGACY_FORMATS = ["written", "poll"] as const;

/** An `issue_questions` row this code wrote: a written or poll question, not a copied section. */
export function legacyAskCondition(): SQL {
  const condition = and(not(issueQuestions.fromSection), inArray(issueQuestions.format, [...LEGACY_FORMATS]));
  if (!condition) throw new Error("Legacy ask condition is empty.");
  return condition;
}

/** A `replies` row that answers one of those questions. */
export function legacyReplyCondition(): SQL {
  return sql`exists (select 1 from ${issueQuestions} where ${issueQuestions.id} = ${replies.issueQuestionId} and ${legacyAskCondition()})`;
}

/** The same rule for hand-written SQL, over an `issue_questions` row aliased as `alias`. */
export function legacyAskSql(alias: string): SQL {
  const q = sql.raw(alias);
  return sql`(not ${q}.from_section and ${q}.format in ('written', 'poll'))`;
}

/**
 * A pool question this code may ask. Copied sections and events arrive with
 * `active = false`, and the next release keeps `active` true only for written and
 * poll questions that take turns, so a rollback never asks a photo wall.
 */
export function legacyPoolCondition(): SQL {
  return eq(questions.active, true);
}

/**
 * The pool including archived questions, for the loop's export. An archived
 * question here always took turns and was written or a poll; a copied section
 * or event asks every round or on a date, so it stays out even when stopped.
 */
export function legacyPoolWithArchivedCondition(): SQL {
  const condition = or(
    legacyPoolCondition(),
    and(
      isNotNull(questions.archivedAt),
      eq(questions.frequency, "rotating"),
      inArray(questions.format, [...LEGACY_FORMATS]),
    ),
  );
  if (!condition) throw new Error("Legacy pool condition is empty.");
  return condition;
}

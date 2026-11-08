import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, memberships, questions } from "@/db/schema";
import { copy, text } from "./copy.ts";
import { formatOf } from "./asks";
import type { Executor } from "./round-questions";
import { issueCoverage, occurrencesInWindow, type EventRule } from "./event-dates.ts";

/*
 * An event is an item asked on a date (docs/questions-unify-design.md): a pool
 * row with `frequency = 'on_date'`, holding a one-time date, or a birthday and
 * the person it is about. Nothing reads it at delivery: when a round opens, each
 * occurrence in the round's days becomes one of its snapshots, claimed once by
 * `(question_id, occurrence_date)`.
 */

type GroupRow = typeof groups.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

/** A dated item with the birthday person's current details, for snapshotting and the list. */
export type DatedItem = {
  question: QuestionRow;
  personName: string | null;
  personEmail: string | null;
  personRevoked: boolean;
};

/** The loop's dated items that are still asked, with the birthday person's current details. */
export async function loadDated(ex: Executor, groupId: string, onlyId?: string): Promise<DatedItem[]> {
  const rows = await ex
    .select({
      question: questions,
      personName: memberships.name,
      personEmail: memberships.email,
      personRevoked: sql<boolean>`${memberships.revokedAt} is not null`,
    })
    .from(questions)
    .leftJoin(memberships, eq(memberships.id, questions.aboutMembershipId))
    .where(and(
      eq(questions.groupId, groupId),
      eq(questions.frequency, "on_date"),
      isNull(questions.archivedAt),
      onlyId ? eq(questions.id, onlyId) : undefined,
    ))
    .orderBy(asc(questions.month), asc(questions.day), asc(questions.createdAt));
  return rows.map((row) => ({ ...row, personRevoked: row.personRevoked === true }));
}

export function personLabel(row: Pick<DatedItem, "personName" | "personEmail">): string {
  return row.personName ?? row.personEmail?.split("@")[0] ?? "";
}

export function kindOf(question: Pick<QuestionRow, "dateKind">): "once" | "birthday" {
  return question.dateKind === "birthday" ? "birthday" : "once";
}

export function ruleOf(question: Pick<QuestionRow, "dateKind" | "month" | "day" | "year">): EventRule {
  return { kind: kindOf(question), month: question.month ?? 1, day: question.day ?? 1, year: question.year };
}

/** What a snapshot of this date reads like, frozen into the round. */
function snapshotTextFor(row: DatedItem): { text: string; description: string } {
  if (kindOf(row.question) === "birthday") {
    const name = personLabel(row);
    return {
      text: text(copy.events.section.birthdayTitle, { name }),
      description: row.question.description ?? text(copy.events.section.birthdayDescription, { name }),
    };
  }
  return { text: row.question.text, description: row.question.description ?? copy.events.section.onceDescription };
}

/**
 * Put every dated item whose day falls in a round's coverage into that round.
 * Safe to repeat: an occurrence (item + date) can be claimed only once, so a
 * retried sweep, an overlapping window or an item added mid-round never makes a
 * second card for the same day. A day the owner took out of a round stays out.
 */
export async function placeDatedItems(input: {
  ex?: Executor;
  group: GroupRow;
  issueId: string;
  opensAt: Date;
  deliversAt: Date;
  onlyQuestionId?: string;
}): Promise<number> {
  const ex = input.ex ?? db;
  const rows = await loadDated(ex, input.group.id, input.onlyQuestionId);
  const window = issueCoverage({ opensAt: input.opensAt, deliversAt: input.deliversAt, timezone: input.group.timezone });
  const claims = rows.flatMap((row) => {
    // A birthday whose person has left the loop has nobody to celebrate.
    if (kindOf(row.question) === "birthday" && (row.question.aboutMembershipId === null || row.personRevoked)) return [];
    return occurrencesInWindow(ruleOf(row.question), window)
      .filter((date) => !row.question.skippedDates.includes(date))
      .map((occurrenceDate) => ({ row, occurrenceDate }));
  });
  if (claims.length === 0) return 0;

  const [{ last }] = await ex
    .select({ last: max(issueQuestions.position) })
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, input.issueId));

  claims.sort((left, right) => left.occurrenceDate.localeCompare(right.occurrenceDate));
  const inserted = await ex
    .insert(issueQuestions)
    .values(
      claims.map(({ row, occurrenceDate }, index) => ({
        issueId: input.issueId,
        questionId: row.question.id,
        ...snapshotTextFor(row),
        kind: row.question.kind,
        format: formatOf(row.question),
        pollMultiple: row.question.pollMultiple,
        pollOptions: row.question.pollOptions,
        emoji: row.question.emoji ?? copy.events.section.defaultEmoji,
        adminOnly: row.question.adminOnly,
        position: (last ?? -1) + 1 + index,
        occurrenceDate,
        aboutMembershipId: kindOf(row.question) === "birthday" ? row.question.aboutMembershipId : null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: issueQuestions.id });
  return inserted.length;
}

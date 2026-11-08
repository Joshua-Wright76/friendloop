import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, questions } from "@/db/schema";
import { copy, text } from "./copy.ts";
import { formatOf } from "./asks";
import type { Executor } from "./round-questions";
import {
  EVENT_TITLE_MAX,
  describeDate,
  issueCoverage,
  localDate,
  nextOccurrence,
  occurrencesInWindow,
  parseDateInput,
  type EventRule,
} from "./event-dates.ts";

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
type DatedItem = {
  question: QuestionRow;
  personName: string | null;
  personEmail: string | null;
  personRevoked: boolean;
};

async function loadDated(ex: Executor, groupId: string, onlyId?: string): Promise<DatedItem[]> {
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

function personLabel(row: Pick<DatedItem, "personName" | "personEmail">): string {
  return row.personName ?? row.personEmail?.split("@")[0] ?? "";
}

function kindOf(question: QuestionRow): "once" | "birthday" {
  return question.dateKind === "birthday" ? "birthday" : "once";
}

function ruleOf(question: QuestionRow): EventRule {
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

/**
 * A date added while a round is already open would miss that round's snapshot. If
 * its day falls inside the open round, add it there now, so nothing owners type in
 * is silently lost to timing.
 */
async function placeInOpenIssue(group: GroupRow, questionId: string): Promise<void> {
  const [open] = await db
    .select()
    .from(issues)
    .where(and(eq(issues.groupId, group.id), eq(issues.status, "open")))
    .limit(1);
  if (!open) return;
  await placeDatedItems({ group, issueId: open.id, opensAt: open.opensAt, deliversAt: open.deliversAt, onlyQuestionId: questionId });
}

export type EventListItem = {
  id: string;
  kind: "once" | "birthday";
  /** What the list calls it: the title, or "Maya's birthday". */
  label: string;
  title: string;
  emoji: string | null;
  membershipId: string | null;
  month: number;
  day: number;
  year: number | null;
  /** Next date on the calendar as ISO, or null for a one-time event that has passed. */
  nextDate: string | null;
  nextLabel: string | null;
  /** The ISO date for the edit form's date input. */
  inputDate: string;
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The list a manager sees: soonest first, with finished one-time events last. */
export async function eventsOf(group: Pick<GroupRow, "id" | "timezone">, at: Date): Promise<EventListItem[]> {
  const today = localDate(at, group.timezone);
  const items = (await loadDated(db, group.id))
    .filter((row) => !(kindOf(row.question) === "birthday" && row.personRevoked))
    .map((row): EventListItem => {
      const rule = ruleOf(row.question);
      const next = nextOccurrence(rule, today);
      return {
        id: row.question.id,
        kind: rule.kind,
        label: rule.kind === "birthday" ? text(copy.events.birthdayRow, { name: personLabel(row) }) : row.question.text,
        title: rule.kind === "birthday" ? "" : row.question.text,
        emoji: row.question.emoji,
        membershipId: row.question.aboutMembershipId,
        month: rule.month,
        day: rule.day,
        year: rule.year,
        nextDate: next,
        nextLabel: next ? describeDate(next) : null,
        inputDate: `${pad(rule.year ?? Number(today.slice(0, 4)), 4)}-${pad(rule.month, 2)}-${pad(rule.day, 2)}`,
      };
    });

  return items.sort((left, right) => {
    if (left.nextDate && right.nextDate) return left.nextDate.localeCompare(right.nextDate);
    if (left.nextDate) return -1;
    if (right.nextDate) return 1;
    return left.label.localeCompare(right.label);
  });
}

export type EventInput = {
  kind: "once" | "birthday";
  title: string;
  emoji: string | null;
  /** `YYYY-MM-DD` from a date input. */
  date: string;
  membershipId: string | null;
};

/** Which copy line explains a refused event: a key of `copy.events.errors`. */
export type EventErrorCode = keyof typeof copy.events.errors;

export type EventWriteResult =
  | { ok: true }
  | { ok: false; code: EventErrorCode };

type DateValues = {
  text: string;
  emoji: string | null;
  dateKind: "once" | "birthday";
  month: number;
  day: number;
  year: number | null;
  aboutMembershipId: string | null;
};

/** Check an event form against the loop; returns the columns to store. */
async function checkEvent(
  group: Pick<GroupRow, "id" | "timezone">,
  input: EventInput,
  options: { at: Date; allowPast: boolean },
): Promise<{ ok: false; code: EventErrorCode } | { ok: true; values: DateValues }> {
  const date = parseDateInput(input.date);
  if (!date) return { ok: false, code: "invalid" };

  const emoji = input.emoji?.trim().slice(0, 8) || null;

  if (input.kind === "birthday") {
    if (!input.membershipId) return { ok: false, code: "memberRequired" };
    const [person] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, input.membershipId),
          eq(memberships.groupId, group.id),
          isNull(memberships.revokedAt),
        ),
      )
      .limit(1);
    if (!person) return { ok: false, code: "memberRequired" };
    return {
      ok: true,
      values: { text: "", emoji, dateKind: "birthday", month: date.month, day: date.day, year: null, aboutMembershipId: person.id },
    };
  }

  const title = input.title.trim();
  if (!title || title.length > EVENT_TITLE_MAX) return { ok: false, code: "titleRequired" };
  if (!options.allowPast && input.date < localDate(options.at, group.timezone)) {
    return { ok: false, code: "pastDate" };
  }
  return {
    ok: true,
    values: { text: title, emoji, dateKind: "once", month: date.month, day: date.day, year: date.year, aboutMembershipId: null },
  };
}

export async function createEvent(input: EventInput & { group: GroupRow; at: Date }): Promise<EventWriteResult> {
  const checked = await checkEvent(input.group, input, { at: input.at, allowPast: false });
  if (!checked.ok) return checked;

  const [created] = await db
    .insert(questions)
    .values({
      ...checked.values,
      groupId: input.group.id,
      position: 0,
      active: false,
      kind: "written",
      format: "written",
      frequency: "on_date",
      createdAt: input.at,
    })
    .returning({ id: questions.id });
  await placeInOpenIssue(input.group, created.id);
  return { ok: true };
}

/** Edit a date. The kind is fixed; a delivered or open round keeps what it snapshotted. */
export async function updateEvent(
  input: Omit<EventInput, "kind"> & { group: GroupRow; eventId: string; at: Date },
): Promise<EventWriteResult> {
  const [existing] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, input.eventId), eq(questions.groupId, input.group.id), eq(questions.frequency, "on_date")))
    .limit(1);
  if (!existing) return { ok: false, code: "invalid" };

  const checked = await checkEvent(
    input.group,
    { ...input, kind: kindOf(existing) },
    { at: input.at, allowPast: true },
  );
  if (!checked.ok) return checked;

  await db.update(questions).set(checked.values).where(eq(questions.id, existing.id));
  await placeInOpenIssue(input.group, existing.id);
  return { ok: true };
}

/** Remove a date. Cards already in a round keep their title and place. */
export async function deleteEvent(input: { groupId: string; eventId: string }): Promise<void> {
  await db
    .delete(questions)
    .where(and(eq(questions.id, input.eventId), eq(questions.groupId, input.groupId), eq(questions.frequency, "on_date")));
}

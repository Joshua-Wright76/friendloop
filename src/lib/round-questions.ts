import { and, asc, eq, inArray, isNull, max, min, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import { db } from "@/db";
import type * as schema from "@/db/schema";
import { groups, issueQuestions, issues, questions, replies } from "@/db/schema";
import { formatOf, legacyActive, type AnswerFormat, type AskFrequency } from "./asks";
import { placeDatedItems } from "./events";
import { takeTurns } from "./round-plan";
import { suggestionCreditsForQuestions } from "./suggestions";

/*
 * The round's questions (docs/questions-unify-design.md, "Rotation and Up next").
 *
 * The pool is one list. Items that take turns, ordered by `position`, are the
 * queue: opening a round takes the first N of them (N is `questions_per_round`,
 * null meaning all) and moves them to the back, then adds every item asked each
 * round, then the dated items whose day falls in the round. Everything after
 * that is a direct edit of the open round; nothing is re-derived from a cursor.
 *
 * `issue_questions` rows are the round's frozen copies. Once anyone has written
 * in one, its words stay as they were answered.
 */

/** The database, or a transaction on it. */
export type Executor = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

type GroupRow = typeof groups.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

/** Pool items a round asks: not stopped, of the given frequency, in their order. */
async function poolOf(ex: Executor, groupId: string, frequency: AskFrequency): Promise<QuestionRow[]> {
  return ex
    .select()
    .from(questions)
    .where(and(eq(questions.groupId, groupId), eq(questions.frequency, frequency), isNull(questions.archivedAt)))
    .orderBy(asc(questions.position), asc(questions.createdAt), asc(questions.id));
}

/** What a snapshot of a pool item holds. The round keeps it even if the item later changes. */
export function snapshotOf(question: QuestionRow, credit: string | null) {
  return {
    questionId: question.id,
    text: question.text,
    suggestedBy: credit,
    kind: question.kind,
    format: formatOf(question),
    pollMultiple: question.pollMultiple,
    pollOptions: question.pollOptions,
    emoji: question.emoji,
    description: question.description,
    adminOnly: question.adminOnly,
  };
}

async function insertSnapshots(ex: Executor, groupId: string, issueId: string, selected: QuestionRow[], firstPosition: number) {
  if (selected.length === 0) return;
  const credits = await suggestionCreditsForQuestions(groupId, selected.map((question) => question.id));
  await ex
    .insert(issueQuestions)
    .values(selected.map((question, index) => ({
      issueId,
      position: firstPosition + index,
      ...snapshotOf(question, credits.get(question.id) ?? null),
    })))
    .onConflictDoNothing({ target: [issueQuestions.issueId, issueQuestions.questionId] });
}

/** Send items that took their turn to the back of the queue, in the order they were taken. */
async function sendToBack(ex: Executor, groupId: string, ids: string[]) {
  if (ids.length === 0) return;
  const [{ last }] = await ex
    .select({ last: max(questions.position) })
    .from(questions)
    .where(and(eq(questions.groupId, groupId), eq(questions.frequency, "rotating")));
  const start = (last ?? -1) + 1;
  const cases = ids.map((id, index) => sql`when ${id}::uuid then ${start + index}::int`);
  await ex
    .update(questions)
    .set({ position: sql`case ${questions.id} ${sql.join(cases, sql` `)} else ${questions.position} end` })
    .where(inArray(questions.id, ids));
}

/** Put items at the front of the queue, in this order: what "skip" used to mean. */
async function sendToFront(ex: Executor, groupId: string, ids: string[]) {
  if (ids.length === 0) return;
  const [{ first }] = await ex
    .select({ first: min(questions.position) })
    .from(questions)
    .where(and(eq(questions.groupId, groupId), eq(questions.frequency, "rotating")));
  const start = (first ?? 0) - ids.length;
  const cases = ids.map((id, index) => sql`when ${id}::uuid then ${start + index}::int`);
  await ex
    .update(questions)
    .set({ position: sql`case ${questions.id} ${sql.join(cases, sql` `)} else ${questions.position} end` })
    .where(inArray(questions.id, ids));
}

/**
 * Snapshot a freshly opened round: the queue's next N, then every-round items,
 * then dated items in the round's days. Runs inside the transaction that locked
 * the loop, so two openings can never take the same turn.
 */
export async function snapshotRound(input: {
  ex?: Executor;
  group: GroupRow;
  issueId: string;
  opensAt: Date;
  deliversAt: Date;
}): Promise<number> {
  const { group, issueId } = input;
  const ex = input.ex ?? db;

  // "Sitting out this round" only ever meant the round it was set in.
  await ex
    .update(questions)
    .set({ skipNext: false })
    .where(and(eq(questions.groupId, group.id), eq(questions.skipNext, true)));

  const taken = takeTurns(await poolOf(ex, group.id, "rotating"), group.questionsPerRound);
  const everyRound = await poolOf(ex, group.id, "every_round");
  await insertSnapshots(ex, group.id, issueId, [...taken, ...everyRound], 0);
  // When every turn-taker is asked each round, the queue's order is just the round's: nothing moves.
  if (group.questionsPerRound !== null) await sendToBack(ex, group.id, taken.map((question) => question.id));
  const dated = await placeDatedItems({ ex, group, issueId, opensAt: input.opensAt, deliversAt: input.deliversAt });
  // After a rollback, code from before the switch re-derives this round from the
  // cursor it opened with, over its pool in order: the turns just taken are now at
  // its back. The loop's own cursor stays 0, the head of the queue.
  const [{ pool }] = await ex
    .select({ pool: sql<number>`count(*)::int` })
    .from(questions)
    .where(and(eq(questions.groupId, group.id), eq(questions.active, true), isNull(questions.archivedAt)));
  const takenActive = taken.filter((question) => question.active).length;
  await ex.update(issues).set({ questionCursor: Math.max(0, pool - takenActive) }).where(eq(issues.id, issueId));
  return taken.length + everyRound.length + dated;
}

type OpenRound = { issue: typeof issues.$inferSelect; group: GroupRow };

async function openRoundWithGroup(ex: Executor, groupId: string): Promise<OpenRound | null> {
  const [row] = await ex
    .select({ group: groups, issue: issues })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open")))
    .limit(1);
  return row ?? null;
}

type RoundRow = { id: string; questionId: string | null; position: number; frequency: AskFrequency | null };

/** The open round's items, in order, with the frequency each came from. */
async function roundRows(ex: Executor, issueId: string): Promise<RoundRow[]> {
  return ex
    .select({
      id: issueQuestions.id,
      questionId: issueQuestions.questionId,
      position: issueQuestions.position,
      frequency: questions.frequency,
    })
    .from(issueQuestions)
    .leftJoin(questions, eq(questions.id, issueQuestions.questionId))
    .where(eq(issueQuestions.issueId, issueId))
    .orderBy(asc(issueQuestions.position), asc(issueQuestions.id));
}

/** Snapshot ids someone has a row in: those keep their place and their words. */
async function writtenIn(ex: Executor, issueId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await ex
    .selectDistinct({ id: replies.issueQuestionId })
    .from(replies)
    .where(and(eq(replies.issueId, issueId), inArray(replies.issueQuestionId, ids)));
  return new Set(rows.map((row) => row.id));
}

const RANK: Record<AskFrequency, number> = { rotating: 0, every_round: 1, on_date: 2 };

/** Turn-takers first, then every-round items, then dates; each group keeps its own order. */
async function renumber(ex: Executor, issueId: string) {
  const rows = await roundRows(ex, issueId);
  const ordered = [...rows].sort((left, right) =>
    (RANK[left.frequency ?? "on_date"] - RANK[right.frequency ?? "on_date"]) || left.position - right.position,
  );
  const moved = ordered.map((row, position) => ({ id: row.id, position, was: row.position })).filter((row) => row.position !== row.was);
  if (moved.length === 0) return;
  const cases = moved.map((row) => sql`when ${row.id}::uuid then ${row.position}::int`);
  await ex
    .update(issueQuestions)
    .set({ position: sql`case ${issueQuestions.id} ${sql.join(cases, sql` `)} else ${issueQuestions.position} end` })
    .where(inArray(issueQuestions.id, moved.map((row) => row.id)));
}

/**
 * Add a pool item to the open round, after the others of its kind. A turn-taker
 * goes to the back of the queue; a dated item is placed only if its day falls in
 * the round. Nothing happens when the loop has no open round or already asks it.
 */
export async function addToOpenRound(groupId: string, questionId: string): Promise<boolean> {
  const open = await openRoundWithGroup(db, groupId);
  if (!open) return false;
  const [question] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, questionId), eq(questions.groupId, groupId), isNull(questions.archivedAt)))
    .limit(1);
  if (!question) return false;

  if (question.frequency === "on_date") {
    const placed = await placeDatedItems({
      group: open.group,
      issueId: open.issue.id,
      opensAt: open.issue.opensAt,
      deliversAt: open.issue.deliversAt,
      onlyQuestionId: question.id,
    });
    return placed > 0;
  }

  const rows = await roundRows(db, open.issue.id);
  if (rows.some((row) => row.questionId === question.id)) return false;
  await insertSnapshots(db, groupId, open.issue.id, [question], (rows.at(-1)?.position ?? -1) + 1);
  if (question.frequency === "rotating" && open.group.questionsPerRound !== null) await sendToBack(db, groupId, [question.id]);
  await renumber(db, open.issue.id);
  return true;
}

export type RemoveResult = "removed" | "written" | "absent";

/**
 * Take a pool item out of the open round, unless someone has written there. A
 * turn-taker goes first in line for the next round (when rounds take turns at
 * all); a dated occurrence is
 * remembered in `skipped_dates`, so carrying the round over doesn't put it back.
 */
export async function removeFromOpenRound(groupId: string, questionId: string): Promise<RemoveResult> {
  const open = await openRoundWithGroup(db, groupId);
  if (!open) return "absent";
  const [row] = await db
    .select({ id: issueQuestions.id, occurrenceDate: issueQuestions.occurrenceDate, frequency: questions.frequency })
    .from(issueQuestions)
    .innerJoin(questions, eq(questions.id, issueQuestions.questionId))
    .where(and(eq(issueQuestions.issueId, open.issue.id), eq(issueQuestions.questionId, questionId)))
    .limit(1);
  if (!row) return "absent";
  if ((await writtenIn(db, open.issue.id, [row.id])).size > 0) return "written";

  await db.delete(issueQuestions).where(eq(issueQuestions.id, row.id));
  // When every turn-taker is asked each round, the queue's order is just the round's.
  if (row.frequency === "rotating" && open.group.questionsPerRound !== null) await sendToFront(db, groupId, [questionId]);
  if (row.frequency === "on_date" && row.occurrenceDate) {
    await db
      .update(questions)
      .set({ skippedDates: sql`array_append(${questions.skippedDates}, ${row.occurrenceDate}::date)` })
      .where(eq(questions.id, questionId));
  }
  await renumber(db, open.issue.id);
  return "removed";
}

/**
 * Carry a pool item's new words into the open round (the K8 rule): its snapshot
 * follows the edit unless someone has already written there, in which case it
 * keeps the words they answered and the next round asks the new ones.
 */
export async function refreshOpenRound(groupId: string, questionId: string): Promise<void> {
  const open = await openRoundWithGroup(db, groupId);
  if (!open) return;
  const [row] = await db
    .select({ snapshot: issueQuestions, question: questions })
    .from(issueQuestions)
    .innerJoin(questions, eq(questions.id, issueQuestions.questionId))
    .where(and(eq(issueQuestions.issueId, open.issue.id), eq(issueQuestions.questionId, questionId)))
    .limit(1);
  if (!row || row.snapshot.occurrenceDate) return;
  if ((await writtenIn(db, open.issue.id, [row.snapshot.id])).size > 0) return;
  const { text, emoji, description, adminOnly } = row.question;
  await db.update(issueQuestions).set({ text, emoji, description, adminOnly }).where(eq(issueQuestions.id, row.snapshot.id));
}

/**
 * The open round after the number of turn-takers per round changed: turn-takers
 * past the new count go back to the front of the queue (they were never really
 * asked) unless someone wrote there, and a larger count takes more from the queue.
 */
export async function resizeOpenRound(groupId: string): Promise<void> {
  const open = await openRoundWithGroup(db, groupId);
  if (!open) return;
  const count = open.group.questionsPerRound;
  const rotating = (await roundRows(db, open.issue.id)).filter((row) => row.frequency === "rotating");

  if (count !== null && rotating.length > count) {
    const written = await writtenIn(db, open.issue.id, rotating.map((row) => row.id));
    const kept = rotating.filter((row) => written.has(row.id));
    const room = Math.max(0, count - kept.length);
    const keep = new Set([...kept.map((row) => row.id), ...rotating.filter((row) => !written.has(row.id)).slice(0, room).map((row) => row.id)]);
    const dropped = rotating.filter((row) => !keep.has(row.id));
    if (dropped.length > 0) {
      await db.delete(issueQuestions).where(inArray(issueQuestions.id, dropped.map((row) => row.id)));
      await sendToFront(db, groupId, dropped.flatMap((row) => (row.questionId ? [row.questionId] : [])));
    }
  } else {
    await fillOpenRound(groupId);
  }
  await renumber(db, open.issue.id);
}

/**
 * Top the open round up from the queue while it holds fewer turn-takers than a
 * round asks: a new question in an "all questions" loop joins the round people
 * are answering now, as it always did.
 */
export async function fillOpenRound(groupId: string): Promise<void> {
  const open = await openRoundWithGroup(db, groupId);
  if (!open) return;
  const rows = await roundRows(db, open.issue.id);
  const asked = new Set(rows.map((row) => row.questionId));
  const rotatingCount = rows.filter((row) => row.frequency === "rotating").length;
  const room = open.group.questionsPerRound === null ? Infinity : open.group.questionsPerRound - rotatingCount;
  if (room <= 0) return;
  // An item sitting this round out stays out of it.
  const fresh = (question: QuestionRow) => !asked.has(question.id) && !question.skipNext;
  const waiting = (await poolOf(db, groupId, "rotating")).filter(fresh);
  const taken = takeTurns(waiting, room === Infinity ? null : room);
  const everyRound = (await poolOf(db, groupId, "every_round")).filter(fresh);
  if (taken.length === 0 && everyRound.length === 0) return;
  await insertSnapshots(db, groupId, open.issue.id, [...taken, ...everyRound], (rows.at(-1)?.position ?? -1) + 1);
  if (open.group.questionsPerRound !== null) await sendToBack(db, groupId, taken.map((question) => question.id));
  await renumber(db, open.issue.id);
}

export type NewItem = {
  groupId: string;
  text: string;
  format: AnswerFormat;
  frequency: AskFrequency;
  /** Written through the question pages (not as a section or a date): see `legacyActive`. */
  asQuestion: boolean;
  at: Date;
  pollMultiple?: boolean;
  pollOptions?: string[] | null;
  emoji?: string | null;
  description?: string | null;
  adminOnly?: boolean;
  createdByMembershipId?: string | null;
  date?: { kind: "once" | "birthday"; month: number; day: number; year: number | null; aboutMembershipId: string | null };
};

/** The position a new item takes: the back of its own group. Sections count from 1000. */
async function nextPosition(groupId: string, frequency: AskFrequency, asQuestion: boolean): Promise<number> {
  if (frequency === "on_date") return 0;
  const floor = frequency === "every_round" && !asQuestion ? 1000 : 0;
  const ceiling = frequency === "every_round" && asQuestion ? 1000 : null;
  const [{ last }] = await db
    .select({ last: max(questions.position) })
    .from(questions)
    .where(and(
      eq(questions.groupId, groupId),
      eq(questions.frequency, frequency),
      frequency === "every_round" ? sql`${questions.position} >= ${floor}` : undefined,
      ceiling === null ? undefined : sql`${questions.position} < ${ceiling}`,
    ));
  return Math.max(floor, (last ?? floor - 1) + 1);
}

/** Add an item to the pool, at the back of its group. Returns its id. */
export async function insertPoolItem(item: NewItem): Promise<string> {
  const [row] = await db
    .insert(questions)
    .values({
      groupId: item.groupId,
      text: item.text,
      position: await nextPosition(item.groupId, item.frequency, item.asQuestion),
      active: legacyActive(item),
      kind: item.format === "poll" ? "poll" : "written",
      format: item.format,
      frequency: item.frequency,
      pollMultiple: item.pollMultiple ?? false,
      pollOptions: item.pollOptions ?? null,
      emoji: item.emoji ?? null,
      description: item.description ?? null,
      adminOnly: item.adminOnly ?? false,
      createdByMembershipId: item.createdByMembershipId ?? null,
      dateKind: item.date?.kind ?? null,
      month: item.date?.month ?? null,
      day: item.date?.day ?? null,
      year: item.date?.year ?? null,
      aboutMembershipId: item.date?.aboutMembershipId ?? null,
      createdAt: item.at,
    })
    .returning({ id: questions.id });
  return row.id;
}

/**
 * How often a new question is asked: it takes turns if the loop has any
 * turn-takers or asks a set number each round, and otherwise joins the loop's
 * every-round questions (an "all questions" loop after the switch).
 */
export async function newQuestionFrequency(groupId: string): Promise<AskFrequency> {
  const [group] = await db.select({ questionsPerRound: groups.questionsPerRound }).from(groups).where(eq(groups.id, groupId)).limit(1);
  if (group?.questionsPerRound !== null) return "rotating";
  const [turnTaker] = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.groupId, groupId), eq(questions.frequency, "rotating"), isNull(questions.archivedAt)))
    .limit(1);
  return turnTaker ? "rotating" : "every_round";
}

/**
 * A question added through the question pages, at the back of the list
 * (`newQuestionFrequency`). It reaches the open round at once when that round
 * has room for it.
 */
export async function addPoolQuestion(input: Omit<NewItem, "frequency" | "asQuestion" | "format"> & { format?: "written" | "poll" }) {
  const id = await insertPoolItem({
    ...input,
    format: input.format ?? "written",
    frequency: await newQuestionFrequency(input.groupId),
    asQuestion: true,
  });
  await fillOpenRound(input.groupId);
  return id;
}

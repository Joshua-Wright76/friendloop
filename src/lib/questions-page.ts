import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, issues, memberships, questions, replies } from "@/db/schema";
import { askedOf, formatOf, type AnswerFormat, type AskFrequency } from "./asks";
import { copy, text } from "./copy.ts";
import { describeDate, localDate, nextOccurrence } from "./event-dates";
import { kindOf, loadDated, personLabel, ruleOf } from "./events";
import { replyHasContentSql } from "./reply-query";
import { firstRounds, planRounds } from "./round-plan";
import { groupSchedule } from "./schedule";

/*
 * What the Questions page shows (docs/questions-unify-design.md, "The Questions
 * page"): the round, not the setup. First what the open round asks, in its own
 * order; then Up next: the turn-takers in queue order, each with the round that
 * will ask it, the items asked every round, and the dated items with their next
 * day. Stopped items fold away below, ready to ask again.
 */

type Access = (typeof memberships.$inferSelect)["access"];

/** One item of the loop's list, as its row and its editor need it. */
export type PageItem = {
  id: string;
  /** What the row calls it: its words, or "Maya's birthday". */
  label: string;
  text: string;
  format: AnswerFormat;
  frequency: AskFrequency;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  pollMultiple: boolean;
  pollOptions: string[] | null;
  dateKind: "once" | "birthday" | null;
  aboutMembershipId: string | null;
  /** The date input's value for a dated item. */
  inputDate: string | null;
  /** A dated item's next day as ISO; null once a one-time event has gone by. */
  nextDate: string | null;
  /** That day for reading: "Fri, Nov 14". */
  nextLabel: string | null;
  /** Someone has answered it in some round, so its format stays. */
  answered: boolean;
  /** The coming round that first asks it, if Up next reaches that far. */
  firstRound: { number: number; deliversAt: Date } | null;
};

/** One item the open round asks, in the round's own order. */
export type RoundItem = {
  /** The round's copy of the item (`issue_questions.id`). */
  id: string;
  questionId: string | null;
  text: string;
  emoji: string | null;
  format: AnswerFormat;
  frequency: AskFrequency | null;
  adminOnly: boolean;
  /** The day of a dated card, and that day for reading. */
  occurrenceDate: string | null;
  occurrenceLabel: string | null;
  /** Whoever has written there, by name: the item stays in this round. */
  writers: string[];
};

export type PlanRound = { number: number; deliversAt: Date; turns: string[]; dated: Array<{ id: string; date: string }> };

export type QuestionsPage = {
  round: { id: string; number: number; name: string | null; deliversAt: Date } | null;
  thisRound: RoundItem[];
  queue: PageItem[];
  everyRound: PageItem[];
  dated: PageItem[];
  stopped: PageItem[];
  plan: PlanRound[];
};

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

const nameOf = (person: { name: string | null; email: string }) => person.name ?? person.email.split("@")[0];

/**
 * Load the page for one viewer. A plain member sees what they could be asked:
 * nothing owners-only, no calendar, no stopped items.
 */
export async function questionsPageOf(input: {
  group: typeof groups.$inferSelect;
  viewer: { id: string; access: Access };
  at: Date;
}): Promise<QuestionsPage> {
  const { group, viewer, at } = input;
  const manages = viewer.access !== "member";

  const [poolRows, [open], datedRows] = await Promise.all([
    db
      .select()
      .from(questions)
      .where(eq(questions.groupId, group.id))
      .orderBy(asc(questions.position), asc(questions.createdAt), asc(questions.id)),
    db.select().from(issues).where(and(eq(issues.groupId, group.id), eq(issues.status, "open"))).limit(1),
    loadDated(db, group.id),
  ]);

  const answeredIds = new Set(
    poolRows.length === 0
      ? []
      : (await db
          .selectDistinct({ id: issueQuestions.questionId })
          .from(issueQuestions)
          .innerJoin(replies, eq(replies.issueQuestionId, issueQuestions.id))
          .where(and(
            inArray(issueQuestions.questionId, poolRows.map((row) => row.id)),
            replyHasContentSql("replies"),
          ))).map((row) => row.id),
  );

  const thisRound = open ? await roundItems(open.id, viewer) : [];

  // Up next: the rounds after the open one, from the queue as it stands.
  const today = localDate(at, group.timezone);
  const living = poolRows.filter((row) => row.archivedAt === null);
  const queueRows = living.filter((row) => row.frequency === "rotating");
  const datedLiving = datedRows.filter((row) => !(kindOf(row.question) === "birthday" && row.personRevoked));
  const plan = planRounds({
    queue: queueRows.map((row) => row.id),
    count: group.questionsPerRound,
    dated: datedLiving.map((row) => ({ id: row.question.id, rule: ruleOf(row.question), skippedDates: row.question.skippedDates })),
    schedule: groupSchedule(group),
    opensAt: open && open.deliversAt.getTime() > at.getTime() ? open.deliversAt : at,
    number: (open?.number ?? (await lastRoundNumber(group.id))) + 1,
    claimed: thisRound.flatMap((row) => (row.questionId && row.occurrenceDate ? [{ id: row.questionId, date: row.occurrenceDate }] : [])),
  });
  const first = firstRounds(plan);
  const birthdayPeople = new Map(datedRows.map((row) => [row.question.id, personLabel(row)]));

  const itemOf = (row: typeof questions.$inferSelect): PageItem => {
    const dated = row.frequency === "on_date" && row.month !== null && row.day !== null;
    const rule = dated ? ruleOf(row) : null;
    const next = rule ? nextOccurrence(rule, today) : null;
    const birthday = dated && kindOf(row) === "birthday";
    const firstUp = first.get(row.id);
    return {
      id: row.id,
      label: birthday ? text(copy.events.birthdayRow, { name: birthdayPeople.get(row.id) ?? "" }) : row.text,
      text: row.text,
      format: formatOf(row),
      frequency: row.frequency,
      emoji: row.emoji,
      description: row.description,
      adminOnly: row.adminOnly,
      pollMultiple: row.pollMultiple,
      pollOptions: row.pollOptions,
      dateKind: dated ? kindOf(row) : null,
      aboutMembershipId: row.aboutMembershipId,
      inputDate: rule ? `${pad(rule.year ?? Number(today.slice(0, 4)), 4)}-${pad(rule.month, 2)}-${pad(rule.day, 2)}` : null,
      nextDate: next,
      nextLabel: next ? describeDate(next) : null,
      answered: answeredIds.has(row.id),
      firstRound: firstUp ? { number: firstUp.round.number, deliversAt: firstUp.round.deliversAt } : null,
    };
  };

  const visible = (row: typeof questions.$inferSelect) => manages || !row.adminOnly;
  const datedIds = new Set(datedLiving.map((row) => row.question.id));
  return {
    round: open ? { id: open.id, number: open.number, name: open.name, deliversAt: open.deliversAt } : null,
    thisRound,
    queue: queueRows.filter(visible).map(itemOf),
    everyRound: living.filter((row) => row.frequency === "every_round").filter(visible).map(itemOf),
    // Soonest first; a one-time event that has gone by sorts last.
    dated: manages
      ? living
          .filter((row) => datedIds.has(row.id))
          .map(itemOf)
          .sort((left, right) => (left.nextDate ?? "9999").localeCompare(right.nextDate ?? "9999") || left.label.localeCompare(right.label))
      : [],
    stopped: manages
      ? poolRows
          .filter((row) => row.archivedAt !== null)
          .sort((left, right) => right.archivedAt!.getTime() - left.archivedAt!.getTime())
          .map(itemOf)
      : [],
    plan: plan.map((round) => ({ number: round.number, deliversAt: round.deliversAt, turns: round.turns, dated: round.dated })),
  };
}

async function lastRoundNumber(groupId: string): Promise<number> {
  const [row] = await db
    .select({ number: issues.number })
    .from(issues)
    .where(eq(issues.groupId, groupId))
    .orderBy(desc(issues.number))
    .limit(1);
  return row?.number ?? 0;
}

/** The open round's items in its order, each with who has written there. */
async function roundItems(issueId: string, viewer: { id: string; access: Access }): Promise<RoundItem[]> {
  const [rows, writers] = await Promise.all([
    db
      .select({ snapshot: issueQuestions, frequency: questions.frequency })
      .from(issueQuestions)
      .leftJoin(questions, eq(questions.id, issueQuestions.questionId))
      .where(eq(issueQuestions.issueId, issueId))
      .orderBy(asc(issueQuestions.position), asc(issueQuestions.id)),
    db
      .selectDistinct({ snapshotId: replies.issueQuestionId, name: memberships.name, email: memberships.email, createdAt: replies.createdAt })
      .from(replies)
      .innerJoin(memberships, eq(memberships.id, replies.membershipId))
      .where(and(eq(replies.issueId, issueId), isNotNull(replies.issueQuestionId)))
      .orderBy(asc(replies.createdAt)),
  ]);
  const byRow = new Map<string, string[]>();
  for (const writer of writers) {
    const names = byRow.get(writer.snapshotId!) ?? [];
    const name = nameOf(writer);
    if (!names.includes(name)) names.push(name);
    byRow.set(writer.snapshotId!, names);
  }
  return rows
    .filter((row) => viewer.access !== "member" || askedOf(row.snapshot, viewer))
    .map(({ snapshot, frequency }) => ({
      id: snapshot.id,
      questionId: snapshot.questionId,
      text: snapshot.text,
      emoji: snapshot.emoji,
      format: formatOf(snapshot),
      frequency,
      adminOnly: snapshot.adminOnly,
      occurrenceDate: snapshot.occurrenceDate,
      occurrenceLabel: snapshot.occurrenceDate ? describeDate(snapshot.occurrenceDate) : null,
      writers: byRow.get(snapshot.id) ?? [],
    }));
}

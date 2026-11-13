import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, issueQuestions, memberships, questions, replies } from "@/db/schema";
import { formatOf, legacyActive, type AnswerFormat, type AskFrequency } from "./asks";
import { localDate, parseDateInput } from "./event-dates";
import { ITEM_DESCRIPTION_MAX, ITEM_EMOJI_MAX, ITEM_TEXT_MAX, QUESTIONS_PER_ROUND_MAX } from "./item-limits";
import { normalizePollOptions, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX } from "./poll";
import { newQuestionTexts } from "./question-packs";
import { replyHasContentCondition } from "./reply-query";
import {
  addToOpenRound,
  insertPoolItem,
  refreshOpenRound,
  removeFromOpenRound,
  sendToBackOf,
  type RemoveResult,
} from "./round-questions";

/*
 * The Questions page's writes (docs/questions-unify-design.md, "The Questions
 * page"). One list of things to ask: each item has an answer format and a
 * frequency (takes turns, every round, or on a date), and optionally an emoji, a
 * description and an owners-only flag. Stopping is the only way to retire one,
 * and asking again brings it back.
 *
 * What an edit does to the round people are answering now:
 * - a new or restarted every-round item joins it, a dated one joins if its day
 *   falls in it, and a turn-taker waits its turn unless the owner asks for it now;
 * - new words reach its copy of the item unless someone has written there;
 * - stopping takes the item out of it unless someone has written there.
 */


export const ANSWER_FORMATS = ["written", "poll", "photo_wall", "music"] as const satisfies readonly AnswerFormat[];
export const ASK_FREQUENCIES = ["rotating", "every_round", "on_date"] as const satisfies readonly AskFrequency[];

/** What the add card and a row's editor send. */
export type ItemInput = {
  text: string;
  format: AnswerFormat;
  frequency: AskFrequency;
  pollOptions: string[];
  pollMultiple: boolean;
  emoji: string;
  description: string;
  adminOnly: boolean;
  /** For an item on a date: a one-time event or a birthday. */
  dateKind: "once" | "birthday";
  /** `YYYY-MM-DD` from a date input. */
  date: string;
  /** For a birthday: whose. */
  aboutMembershipId: string | null;
};

/** Which line of `copy.questions.errors` explains a refused item. */
export type ItemErrorCode = "text" | "poll" | "date" | "pastDate" | "person" | "gone";

export type ItemResult = { ok: true; id: string } | { ok: false; code: ItemErrorCode };

type GroupRow = typeof groups.$inferSelect;

type ItemValues = {
  text: string;
  format: AnswerFormat;
  kind: "written" | "poll";
  frequency: AskFrequency;
  pollMultiple: boolean;
  pollOptions: string[] | null;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  dateKind: "once" | "birthday" | null;
  month: number | null;
  day: number | null;
  year: number | null;
  aboutMembershipId: string | null;
};

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Read the item fields from a submitted form. Anything unknown falls back to the plain choice. */
export function itemInputFrom(form: FormData): ItemInput {
  const field = (name: string) => String(form.get(name) ?? "");
  return {
    text: field("text"),
    format: oneOf(field("format"), ANSWER_FORMATS, "written"),
    frequency: oneOf(field("frequency"), ASK_FREQUENCIES, "rotating"),
    pollOptions: form.getAll("option").map((value) => String(value)),
    pollMultiple: form.get("multiple") === "on",
    emoji: field("emoji"),
    description: field("description"),
    adminOnly: form.get("adminOnly") === "on",
    dateKind: field("dateKind") === "birthday" ? "birthday" : "once",
    date: field("date"),
    aboutMembershipId: field("aboutMembershipId") || null,
  };
}

/** Check an item against the loop; returns the columns to store. */
async function checkItem(
  group: Pick<GroupRow, "id" | "timezone">,
  input: ItemInput,
  options: { at: Date; allowPast: boolean },
): Promise<{ ok: true; values: ItemValues } | { ok: false; code: ItemErrorCode }> {
  const birthday = input.frequency === "on_date" && input.dateKind === "birthday";
  // A birthday is titled from the person's name when its round opens.
  const text = birthday ? "" : input.text.trim();
  if (!birthday && (!text || text.length > ITEM_TEXT_MAX)) return { ok: false, code: "text" };

  let pollOptions: string[] | null = null;
  if (input.format === "poll") {
    pollOptions = normalizePollOptions(input.pollOptions);
    if (pollOptions.length < POLL_MIN_OPTIONS || pollOptions.length > POLL_MAX_OPTIONS || pollOptions.some((option) => option.length > POLL_OPTION_MAX)) {
      return { ok: false, code: "poll" };
    }
  }

  let date: Pick<ItemValues, "dateKind" | "month" | "day" | "year" | "aboutMembershipId"> = {
    dateKind: null, month: null, day: null, year: null, aboutMembershipId: null,
  };
  if (input.frequency === "on_date") {
    const parsed = parseDateInput(input.date);
    if (!parsed) return { ok: false, code: "date" };
    if (birthday) {
      const [person] = input.aboutMembershipId
        ? await db
            .select({ id: memberships.id })
            .from(memberships)
            .where(and(eq(memberships.id, input.aboutMembershipId), eq(memberships.groupId, group.id), isNull(memberships.revokedAt)))
            .limit(1)
        : [];
      if (!person) return { ok: false, code: "person" };
      date = { dateKind: "birthday", month: parsed.month, day: parsed.day, year: null, aboutMembershipId: person.id };
    } else {
      if (!options.allowPast && input.date.trim() < localDate(options.at, group.timezone)) return { ok: false, code: "pastDate" };
      date = { dateKind: "once", month: parsed.month, day: parsed.day, year: parsed.year, aboutMembershipId: null };
    }
  }

  return {
    ok: true,
    values: {
      text,
      format: input.format,
      kind: input.format === "poll" ? "poll" : "written",
      frequency: input.frequency,
      pollMultiple: input.format === "poll" && input.pollMultiple,
      pollOptions,
      emoji: input.emoji.trim().slice(0, ITEM_EMOJI_MAX) || null,
      description: input.description.trim().slice(0, ITEM_DESCRIPTION_MAX) || null,
      adminOnly: input.adminOnly,
      ...date,
    },
  };
}

/** Whether anyone has answered this item in any round: then its format stays. */
export async function hasAnswers(questionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: replies.id })
    .from(replies)
    .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
    .where(and(eq(issueQuestions.questionId, questionId), replyHasContentCondition()))
    .limit(1);
  return Boolean(row);
}

/**
 * Add an item from the one add card. An every-round item joins the round people
 * are answering now and a dated one does if its day falls in it; a turn-taker
 * waits its turn, unless `thisRound` asks for it now too (then it goes to the back
 * of the queue, having had this turn). Asked for this round, it goes last in it.
 */
export async function createItem(input: {
  group: Pick<GroupRow, "id" | "timezone">;
  item: ItemInput;
  thisRound: boolean;
  at: Date;
  createdByMembershipId?: string | null;
}): Promise<ItemResult> {
  const checked = await checkItem(input.group, input.item, { at: input.at, allowPast: false });
  if (!checked.ok) return checked;
  const { values } = checked;
  const id = await insertPoolItem({
    groupId: input.group.id,
    text: values.text,
    format: values.format,
    frequency: values.frequency,
    pollMultiple: values.pollMultiple,
    pollOptions: values.pollOptions,
    emoji: values.emoji,
    description: values.description,
    adminOnly: values.adminOnly,
    createdByMembershipId: input.createdByMembershipId ?? null,
    date: values.dateKind
      ? { kind: values.dateKind, month: values.month!, day: values.day!, year: values.year, aboutMembershipId: values.aboutMembershipId }
      : undefined,
    at: input.at,
  });
  if (input.thisRound || values.frequency !== "rotating") await addToOpenRound(input.group.id, id, { end: input.thisRound });
  return { ok: true, id };
}

/**
 * Save a row's editor. Its words, emoji, description and owners-only flag reach
 * the open round's copy unless someone wrote there (the K8 rule). Its format stays
 * once anyone has answered it. Asked every round from now, it joins the open
 * round; taking turns from now, it goes to the back of the queue.
 */
export async function updateItem(input: {
  group: Pick<GroupRow, "id" | "timezone">;
  questionId: string;
  item: ItemInput;
  at: Date;
}): Promise<ItemResult> {
  const [existing] = await db
    .select()
    .from(questions)
    .where(and(eq(questions.id, input.questionId), eq(questions.groupId, input.group.id), isNull(questions.archivedAt)))
    .limit(1);
  if (!existing) return { ok: false, code: "gone" };

  const item = { ...input.item };
  if (await hasAnswers(existing.id)) {
    // The answers people gave are in its format, and a poll's picks point at its options:
    // changing either would make them answers to something else.
    item.format = formatOf(existing);
    item.pollOptions = existing.pollOptions ?? [];
    item.pollMultiple = existing.pollMultiple;
  }
  const checked = await checkItem(input.group, item, { at: input.at, allowPast: true });
  if (!checked.ok) return checked;
  const { values } = checked;
  const moved = values.frequency !== existing.frequency;

  await db
    .update(questions)
    .set({
      ...values,
      // Only ever narrowed: a section's copy stays out of reach of the code before the switch.
      active: existing.active && legacyActive(values),
    })
    .where(eq(questions.id, existing.id));
  if (moved && values.frequency !== "on_date") await sendToBackOf(input.group.id, existing.id, values.frequency);

  await refreshOpenRound(input.group.id, existing.id);
  if (moved && values.frequency === "every_round") await addToOpenRound(input.group.id, existing.id);
  // A date moved into the open round's days joins it.
  if (values.frequency === "on_date") await addToOpenRound(input.group.id, existing.id);
  return { ok: true, id: existing.id };
}

/**
 * Stop asking an item. It leaves the open round unless someone wrote there, and
 * the round takes nothing in its place. Past rounds keep it as it was.
 */
export async function stopAsking(groupId: string, questionId: string, at: Date): Promise<RemoveResult | null> {
  const stopped = await db
    .update(questions)
    .set({ archivedAt: at })
    .where(and(eq(questions.id, questionId), eq(questions.groupId, groupId), isNull(questions.archivedAt)))
    .returning({ id: questions.id });
  if (stopped.length === 0) return null;
  return removeFromOpenRound(groupId, questionId);
}

/**
 * Ask a stopped item again. A turn-taker goes to the back of the queue; an
 * every-round item joins the open round, and a dated one does if its day falls in it.
 */
export async function askAgain(groupId: string, questionId: string): Promise<boolean> {
  const [restored] = await db
    .update(questions)
    .set({ archivedAt: null })
    .where(and(eq(questions.id, questionId), eq(questions.groupId, groupId), isNotNull(questions.archivedAt)))
    .returning({ id: questions.id, frequency: questions.frequency });
  if (!restored) return false;
  if (restored.frequency === "rotating") await sendToBackOf(groupId, restored.id, "rotating");
  else await addToOpenRound(groupId, restored.id);
  return true;
}

/** Ask one of the waiting items in the open round too, last in it. */
export async function askThisRound(groupId: string, questionId: string): Promise<boolean> {
  return addToOpenRound(groupId, questionId, { end: true });
}

/**
 * Add library questions, skipping any the loop already asks. They're written
 * questions that take turns, so they wait at the back of the queue.
 */
export async function addQuestionTexts(groupId: string, texts: string[], at: Date): Promise<number> {
  const existing = await db
    .select({ text: questions.text })
    .from(questions)
    .where(and(eq(questions.groupId, groupId), isNull(questions.archivedAt)));
  const fresh = newQuestionTexts(texts, existing.map((row) => row.text));
  for (const text of fresh) await insertPoolItem({ groupId, text, format: "written", frequency: "rotating", at });
  return fresh.length;
}

/**
 * How many turn-takers each coming round asks; null asks all of them. The round
 * people are answering now is edited directly, so it stays as it is.
 */
export async function setQuestionsPerRound(groupId: string, questionsPerRound: number | null): Promise<boolean> {
  if (questionsPerRound !== null && (!Number.isInteger(questionsPerRound) || questionsPerRound < 1 || questionsPerRound > QUESTIONS_PER_ROUND_MAX)) {
    return false;
  }
  await db.update(groups).set({ questionsPerRound }).where(eq(groups.id, groupId));
  return true;
}

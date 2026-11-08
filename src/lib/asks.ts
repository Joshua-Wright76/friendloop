import type { issueQuestions, memberships, questions } from "@/db/schema";

/*
 * One list of things to ask (docs/questions-unify-design.md).
 *
 * A question, a section and an event are now the same row: an item in
 * `questions` with an answer format and a frequency, snapshotted into a round as
 * an `issue_questions` row and answered in `replies` (plus `reply_media` for a
 * photo wall). These are the small rules every reader and writer shares.
 */

export type AnswerFormat = "written" | "poll" | "photo_wall" | "music";
export type AskFrequency = (typeof questions.$inferSelect)["frequency"];
type Access = (typeof memberships.$inferSelect)["access"];

/** The format of a pool or round row. Rows from before the format column read as their kind. */
export function formatOf(row: { format: AnswerFormat | null; kind: "written" | "poll" }): AnswerFormat {
  return row.format ?? row.kind;
}

/** Whether a round's item lays out like a section did: copied from one, or a photo wall or music pick. */
export function isSectionLike(row: { fromSection: boolean; format: AnswerFormat | null; kind: "written" | "poll" }): boolean {
  const format = formatOf(row);
  return row.fromSection || format === "photo_wall" || format === "music";
}

/**
 * Whether this person is asked an item in a round: owners-only items skip plain
 * members, and a birthday card skips the person it is about, on the sheet, in
 * prompts and in the next round's list.
 */
export function askedOf(
  row: Pick<typeof issueQuestions.$inferSelect, "adminOnly" | "aboutMembershipId">,
  person: { id: string; access: Access },
): boolean {
  if (row.adminOnly && person.access === "member") return false;
  return row.aboutMembershipId !== person.id;
}

/** How an item is named in a list: its emoji, then its words. */
export function askLabel(row: { text: string; emoji: string | null }): string {
  return row.emoji ? `${row.emoji} ${row.text}` : row.text;
}

/**
 * `questions.active` keeps its old meaning until the contract release: "code from
 * before the switch may ask this as a question". Only written and poll questions
 * that take turns or are asked every round as questions are; sections, dates,
 * photo walls and music picks never are, so a rollback never asks one.
 */
export function legacyActive(row: { format: AnswerFormat; frequency: AskFrequency; asQuestion: boolean }): boolean {
  return row.asQuestion && (row.format === "written" || row.format === "poll") && row.frequency !== "on_date";
}

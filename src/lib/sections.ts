import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { questions } from "@/db/schema";
import { copy } from "./copy.ts";
import { formatOf } from "./asks";
import { addToOpenRound, insertPoolItem, refreshOpenRound, removeFromOpenRound } from "./round-questions";

/*
 * The old "Sections and dates" tab, on the unified pool (docs/questions-unify-
 * design.md, PR B). A section is now an item asked every round that isn't one of
 * the loop's questions (`active = false`), numbered from 1000 so it follows the
 * questions. The Questions page that replaces this tab deletes the module.
 */

export const SECTION_TITLE_MAX = 80;
export const SECTION_DESCRIPTION_MAX = 200;

export type SectionKind = "standard" | "photo_wall" | "music";

const FIRST_SECTION_POSITION = 1000;

function sectionKindOf(format: ReturnType<typeof formatOf>): SectionKind {
  return format === "photo_wall" || format === "music" ? format : "standard";
}

function sectionCondition(groupId: string) {
  return and(
    eq(questions.groupId, groupId),
    eq(questions.frequency, "every_round"),
    eq(questions.active, false),
    isNull(questions.archivedAt),
  );
}

/** The tab's list: every-round items that aren't questions, in order. */
export async function sectionsOf(groupId: string) {
  const rows = await db.select().from(questions).where(sectionCondition(groupId)).orderBy(asc(questions.position), asc(questions.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: sectionKindOf(formatOf(row)),
    title: row.text,
    emoji: row.emoji,
    description: row.description,
    adminOnly: row.adminOnly,
    active: true,
    position: row.position,
  }));
}

function tidy(input: { emoji: string | null; description: string | null }) {
  return {
    emoji: input.emoji?.trim()?.slice(0, 8) || null,
    description: input.description?.trim()?.slice(0, SECTION_DESCRIPTION_MAX) || null,
  };
}

export async function createSection(input: {
  groupId: string;
  kind: SectionKind;
  title: string;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  at: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title || title.length > SECTION_TITLE_MAX) {
    return { ok: false, error: copy.reply.errors.sectionSaveFailed };
  }
  const id = await insertPoolItem({
    groupId: input.groupId,
    text: title,
    format: input.kind === "standard" ? "written" : input.kind,
    frequency: "every_round",
    asQuestion: false,
    adminOnly: input.adminOnly,
    at: input.at,
    ...tidy(input),
  });
  await addToOpenRound(input.groupId, id);
  return { ok: true };
}

/** Edit a section. Unticking "Include in future issues" stops asking it. */
export async function updateSection(input: {
  groupId: string;
  sectionId: string;
  title: string;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  active: boolean;
  at?: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title || title.length > SECTION_TITLE_MAX) {
    return { ok: false, error: copy.reply.errors.sectionSaveFailed };
  }
  await db
    .update(questions)
    .set({ text: title, adminOnly: input.adminOnly, ...tidy(input) })
    .where(and(eq(questions.id, input.sectionId), eq(questions.groupId, input.groupId)));
  if (!input.active) {
    await archiveSection({ groupId: input.groupId, sectionId: input.sectionId, at: input.at ?? new Date() });
    return { ok: true };
  }
  await refreshOpenRound(input.groupId, input.sectionId);
  return { ok: true };
}

export async function moveSection(input: {
  groupId: string;
  sectionId: string;
  targetIndex: number;
}): Promise<void> {
  const pool = await sectionsOf(input.groupId);
  const moving = pool.find((section) => section.id === input.sectionId);
  if (!moving) return;
  const ordered = pool.filter((section) => section.id !== input.sectionId);
  ordered.splice(Math.max(0, Math.min(ordered.length, input.targetIndex)), 0, moving);
  const changed = ordered
    .map((section, index) => ({ id: section.id, position: FIRST_SECTION_POSITION + index, was: section.position }))
    .filter((section) => section.position !== section.was);
  if (changed.length === 0) return;
  const cases = changed.map((section) => sql`when ${section.id}::uuid then ${section.position}::int`);
  await db
    .update(questions)
    .set({ position: sql`case ${questions.id} ${sql.join(cases, sql` `)} else ${questions.position} end` })
    .where(sectionCondition(input.groupId));
}

/** Stop asking a section: it leaves the open round unless someone wrote there. */
export async function archiveSection(input: { groupId: string; sectionId: string; at: Date }): Promise<void> {
  const stopped = await db
    .update(questions)
    .set({ archivedAt: input.at })
    .where(and(eq(questions.id, input.sectionId), eq(questions.groupId, input.groupId), isNull(questions.archivedAt)))
    .returning({ id: questions.id });
  if (stopped.length > 0) await removeFromOpenRound(input.groupId, input.sectionId);
}

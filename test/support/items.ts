/**
 * Add an item the way the Questions page's add card does (`createItem`), with
 * the plain choices filled in: written, asked every round, nothing optional.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { createItem, type ItemInput } from "../../src/lib/ask-items.ts";

export const BLANK_ITEM: ItemInput = {
  text: "",
  format: "written",
  frequency: "every_round",
  pollOptions: [],
  pollMultiple: false,
  emoji: "",
  description: "",
  adminOnly: false,
  dateKind: "once",
  date: "",
  aboutMembershipId: null,
};

export async function addItem(groupId: string, item: Partial<ItemInput> & { text: string }, options: { thisRound?: boolean; at?: Date } = {}) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  return createItem({ group, item: { ...BLANK_ITEM, ...item }, thisRound: options.thisRound ?? false, at: options.at ?? new Date() });
}

type Kind = "standard" | "photo_wall" | "music";

/** What the old tab called a section: an item asked every round, in one of three formats. */
export async function addSection(input: { groupId: string; kind?: Kind; title: string; emoji?: string | null; adminOnly?: boolean }) {
  const result = await addItem(input.groupId, {
    text: input.title,
    format: input.kind === "photo_wall" || input.kind === "music" ? input.kind : "written",
    emoji: input.emoji ?? "",
    adminOnly: input.adminOnly ?? false,
  });
  return result.ok ? { ok: true as const } : result;
}

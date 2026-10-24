import { copy } from "./copy.ts";

/** Questions that already work for a group of friends. Pick a few, edit, or write your own. */
export const QUESTION_BANK: Array<{ group: string; text: string }> = copy.newLoop.questionBank;

export function bankByGroup(): Array<{ group: string; questions: string[] }> {
  const groups = new Map<string, string[]>();
  for (const entry of QUESTION_BANK) {
    const list = groups.get(entry.group) ?? [];
    list.push(entry.text);
    groups.set(entry.group, list);
  }
  return [...groups.entries()].map(([group, questions]) => ({ group, questions }));
}

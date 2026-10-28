import { copy } from "./copy.ts";

export type QuestionPack = { id: string; name: string; questions: string[] };

/** The starter library: themed packs an owner can browse and pick from. */
export const QUESTION_PACKS: QuestionPack[] = copy.questionPacks;

/** Which packs to show: all of them when no filter is active. */
export function visiblePacks(packs: QuestionPack[], activeIds: string[]): QuestionPack[] {
  if (activeIds.length === 0) return packs;
  const active = new Set(activeIds);
  return packs.filter((pack) => active.has(pack.id));
}

/**
 * Questions that can join a pool: trimmed, non-blank, and not already there.
 * Order follows the candidate list, so library order decides where they land.
 */
export function newQuestionTexts(candidates: string[], existing: string[]): string[] {
  const taken = new Set(existing);
  const fresh: string[] = [];
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value || taken.has(value)) continue;
    taken.add(value);
    fresh.push(value);
  }
  return fresh;
}

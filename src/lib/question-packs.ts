import { copy } from "./copy.ts";

export type QuestionPack = { id: string; name: string; questions: string[] };

/** The starter library: themed packs an owner can browse and pick from. */
export const QUESTION_PACKS: QuestionPack[] = copy.questionPacks;

export type PackStatus = {
  /** Questions in the pack that are not in the pool yet: the only ones that can be picked. */
  addable: string[];
  inPool: number;
  picked: number;
  /** Every addable question is picked (false when there is nothing left to add). */
  allPicked: boolean;
};

/** Where a pack stands against the pool and the current picks. */
export function packStatus(pack: QuestionPack, picked: string[], pool: string[]): PackStatus {
  const pooled = new Set(pool);
  const chosen = new Set(picked);
  const addable = pack.questions.filter((question) => !pooled.has(question));
  const pickedCount = addable.filter((question) => chosen.has(question)).length;
  return {
    addable,
    inPool: pack.questions.length - addable.length,
    picked: pickedCount,
    allPicked: addable.length > 0 && pickedCount === addable.length,
  };
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

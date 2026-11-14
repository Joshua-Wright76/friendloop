import type { QuestionPack } from "./question-packs.ts";

/** How many questions a new loop starts with, already picked in the wizard. */
export const STARTER_COUNT = 15;

/**
 * How many of them each round asks. A new loop takes turns through its pool from
 * the start, so round 2 asks something round 1 didn't, and fifteen last three rounds.
 */
export const STARTER_PER_ROUND = 5;

/** The packs a starter set is drawn from: everyday questions that suit any group, any week. */
export const STARTER_PACK_IDS = ["everyday", "tiny-joys", "friendship", "weekend", "food"];

/**
 * A new loop's starting questions: one from each starter pack in turn, so every
 * round mixes themes. With `random`, the packs and the questions inside them are
 * shuffled, so two loops started the same week rarely ask the same things; without
 * it the order is the library's, which is what the end-to-end suite relies on.
 */
export function starterQuestions(packs: QuestionPack[], random: (() => number) | null): string[] {
  const order = (items: string[]) => (random ? shuffled(items, random) : items);
  const chosen = STARTER_PACK_IDS.flatMap((id) => packs.filter((pack) => pack.id === id));
  const lanes = (random ? shuffled(chosen, random) : chosen).map((pack) => order(pack.questions));

  const picked: string[] = [];
  const seen = new Set<string>();
  for (let depth = 0; picked.length < STARTER_COUNT && lanes.some((lane) => depth < lane.length); depth += 1) {
    for (const lane of lanes) {
      const question = lane[depth];
      if (question === undefined || seen.has(question)) continue;
      seen.add(question);
      picked.push(question);
      if (picked.length === STARTER_COUNT) break;
    }
  }
  return picked;
}

/**
 * How many questions a loop made with this pool asks each round: rotation is on
 * whenever the pool holds more than one round's worth. Null asks all of them.
 */
export function starterQuestionsPerRound(poolSize: number): number | null {
  return poolSize > STARTER_PER_ROUND ? STARTER_PER_ROUND : null;
}

/** Fisher–Yates, on a copy. */
function shuffled<T>(items: T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

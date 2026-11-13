import { test } from "node:test";
import assert from "node:assert/strict";
import { QUESTION_PACKS } from "./question-packs.ts";
import { STARTER_COUNT, STARTER_PACK_IDS, STARTER_PER_ROUND, starterQuestions, starterQuestionsPerRound } from "./starter-questions.ts";

const packOf = new Map(QUESTION_PACKS.flatMap((pack) => pack.questions.map((question) => [question, pack.id] as const)));

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
}

test("every starter pack is in the library", () => {
  for (const id of STARTER_PACK_IDS) assert.ok(QUESTION_PACKS.some((pack) => pack.id === id), id);
});

test("a new loop starts with a full set of distinct questions from the library", () => {
  for (const random of [null, seeded(1), seeded(2)]) {
    const picked = starterQuestions(QUESTION_PACKS, random);
    assert.equal(picked.length, STARTER_COUNT);
    assert.equal(new Set(picked).size, STARTER_COUNT);
    // Each one is a pack question, so the wizard shows it as a ticked box.
    for (const question of picked) assert.ok(STARTER_PACK_IDS.includes(packOf.get(question) ?? ""), question);
  }
});

test("each round's worth mixes themes instead of drawing from one pack", () => {
  const picked = starterQuestions(QUESTION_PACKS, seeded(3));
  for (let start = 0; start < picked.length; start += STARTER_PER_ROUND) {
    const round = picked.slice(start, start + STARTER_PER_ROUND);
    assert.equal(new Set(round.map((question) => packOf.get(question))).size, round.length);
  }
});

test("without randomness the order is the library's, one pack at a time", () => {
  const packs = STARTER_PACK_IDS.map((id) => QUESTION_PACKS.find((pack) => pack.id === id)!);
  assert.deepEqual(
    starterQuestions(QUESTION_PACKS, null).slice(0, packs.length + 1),
    [...packs.map((pack) => pack.questions[0]), packs[0].questions[1]],
  );
});

test("two loops rarely start on the same questions", () => {
  const firstRounds = new Set(
    Array.from({ length: 20 }, (_, seed) => starterQuestions(QUESTION_PACKS, seeded(seed + 10)).slice(0, STARTER_PER_ROUND).join("|")),
  );
  assert.ok(firstRounds.size >= 18, `only ${firstRounds.size} different first rounds in 20 loops`);
});

test("rotation is on once the pool holds more than one round", () => {
  assert.equal(starterQuestionsPerRound(STARTER_COUNT), STARTER_PER_ROUND);
  assert.equal(starterQuestionsPerRound(STARTER_PER_ROUND + 1), STARTER_PER_ROUND);
  assert.equal(starterQuestionsPerRound(STARTER_PER_ROUND), null);
  assert.equal(starterQuestionsPerRound(1), null);
});

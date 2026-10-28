import assert from "node:assert/strict";
import test from "node:test";
import { QUESTION_PACKS, newQuestionTexts, visiblePacks } from "./question-packs.ts";

test("every pack has a unique id and name, and holds real questions", () => {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const pack of QUESTION_PACKS) {
    assert.match(pack.id, /^[a-z0-9-]+$/, `${pack.id} should be a slug`);
    assert.ok(pack.name.trim().length > 0);
    assert.ok(pack.questions.length >= 8, `${pack.name} needs enough questions to rotate through`);
    assert.equal(ids.has(pack.id), false, `duplicate pack id ${pack.id}`);
    assert.equal(names.has(pack.name), false, `duplicate pack name ${pack.name}`);
    ids.add(pack.id);
    names.add(pack.name);
    for (const question of pack.questions) {
      assert.equal(question, question.trim());
      assert.ok(question.length > 0 && question.length <= 200);
      assert.doesNotMatch(question, /\{[a-zA-Z][a-zA-Z0-9]*\}/);
    }
  }
});

test("no question appears twice across the whole library", () => {
  const all = QUESTION_PACKS.flatMap((pack) => pack.questions);
  assert.equal(new Set(all).size, all.length, "a repeated question would tick two checkboxes at once");
});

test("the first pack still starts with the classic openers", () => {
  assert.equal(QUESTION_PACKS[0].id, "everyday");
  assert.equal(QUESTION_PACKS[0].questions[0], "What made you laugh this week?");
  assert.equal(QUESTION_PACKS[0].questions[1], "What are you looking forward to?");
});

test("a filter shows all packs, or just the active ones in library order", () => {
  const packs = QUESTION_PACKS.slice(0, 3);
  assert.deepEqual(visiblePacks(packs, []), packs);
  assert.deepEqual(visiblePacks(packs, [packs[2].id, packs[0].id, "unknown"]).map((pack) => pack.id), [
    packs[0].id,
    packs[2].id,
  ]);
});

test("new questions skip blanks, duplicates, and anything already in the pool", () => {
  assert.deepEqual(
    newQuestionTexts(["  First  ", "", "Second", "First", "Third"], ["Third", "Second", "Taken"]),
    ["First"],
  );
  assert.deepEqual(newQuestionTexts([], ["Anything"]), []);
  assert.deepEqual(newQuestionTexts(["  ", "\n"], []), []);
});

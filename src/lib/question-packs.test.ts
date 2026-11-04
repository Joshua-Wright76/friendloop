import assert from "node:assert/strict";
import test from "node:test";
import { QUESTION_PACKS, newQuestionTexts, packStatus } from "./question-packs.ts";

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

test("a pack counts what is already in the pool and what is picked from the rest", () => {
  const pack = { id: "p", name: "P", questions: ["One", "Two", "Three"] };
  assert.deepEqual(packStatus(pack, [], []), { addable: ["One", "Two", "Three"], inPool: 0, picked: 0, allPicked: false });
  // A picked question that is already in the pool does not count twice.
  assert.deepEqual(packStatus(pack, ["One", "Two", "Elsewhere"], ["Two"]), { addable: ["One", "Three"], inPool: 1, picked: 1, allPicked: false });
  assert.deepEqual(packStatus(pack, ["One", "Three"], ["Two"]), { addable: ["One", "Three"], inPool: 1, picked: 2, allPicked: true });
  // Nothing left to add is never "all picked", so the pack offers no Remove all.
  assert.deepEqual(packStatus(pack, [], ["One", "Two", "Three"]), { addable: [], inPool: 3, picked: 0, allPicked: false });
});

test("new questions skip blanks, duplicates, and anything already in the pool", () => {
  assert.deepEqual(
    newQuestionTexts(["  First  ", "", "Second", "First", "Third"], ["Third", "Second", "Taken"]),
    ["First"],
  );
  assert.deepEqual(newQuestionTexts([], ["Anything"]), []);
  assert.deepEqual(newQuestionTexts(["  ", "\n"], []), []);
});

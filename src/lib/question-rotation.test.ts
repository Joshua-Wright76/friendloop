import assert from "node:assert/strict";
import test from "node:test";
import { selectRoundQuestions } from "./question-rotation.ts";

const pool = ["a", "b", "c", "d", "e"].map((id) => ({ id, skipNext: false }));
const ids = (selected: Array<{ id: string }>) => selected.map((question) => question.id);

test("a null count preserves the current all-questions behavior", () => {
  const result = selectRoundQuestions(pool, null, 3);
  assert.deepEqual(ids(result.selected), ["a", "b", "c", "d", "e"]);
  assert.equal(result.nextCursor, 0);
});

test("rotation advances through the pool and wraps at the end", () => {
  const first = selectRoundQuestions(pool, 2, 0);
  assert.deepEqual(ids(first.selected), ["a", "b"]);
  assert.equal(first.nextCursor, 2);

  const second = selectRoundQuestions(pool, 2, first.nextCursor);
  assert.deepEqual(ids(second.selected), ["c", "d"]);
  assert.equal(second.nextCursor, 4);

  const third = selectRoundQuestions(pool, 2, second.nextCursor);
  assert.deepEqual(ids(third.selected), ["e", "a"]);
  assert.equal(third.nextCursor, 1);
});

test("skip-next questions stay out without reducing the requested count", () => {
  const rotated = pool.map((question) => ({ ...question, skipNext: question.id === "b" }));
  const result = selectRoundQuestions(rotated, 2, 0);
  assert.deepEqual(ids(result.selected), ["a", "c"]);
  assert.equal(result.nextCursor, 3);
});

test("skip-next does not move the cursor backward when the eligible set is small", () => {
  const skipped = pool.map((question) => ({ ...question, skipNext: question.id === "a" }));
  const result = selectRoundQuestions(skipped, 4, 4);
  assert.deepEqual(ids(result.selected), ["e", "b", "c", "d"]);
  assert.equal(result.nextCursor, 4);
});

test("a stale cursor is wrapped and a count above the pool selects everything", () => {
  assert.deepEqual(ids(selectRoundQuestions(pool, 2, 12).selected), ["c", "d"]);
  const all = selectRoundQuestions(pool, 10, 3);
  assert.deepEqual(ids(all.selected), ["a", "b", "c", "d", "e"]);
  assert.equal(all.nextCursor, 0);
});

test("an empty or fully skipped pool produces no questions", () => {
  assert.deepEqual(selectRoundQuestions([], 2, 0), { selected: [], nextCursor: 0 });
  const skipped = pool.map((question) => ({ ...question, skipNext: true }));
  assert.deepEqual(selectRoundQuestions(skipped, 2, 0), { selected: [], nextCursor: 0 });
});

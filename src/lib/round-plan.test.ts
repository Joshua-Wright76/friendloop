import { test } from "node:test";
import assert from "node:assert/strict";
import { takeTurns } from "./round-plan.ts";

const queue = ["q1", "q2", "q3", "q4", "q5"];

test("a round takes the head of the queue, as many as it asks", () => {
  assert.deepEqual(takeTurns(queue, 2), ["q1", "q2"]);
  assert.deepEqual(takeTurns(queue, 9), queue, "a count larger than the queue takes all of it");
  assert.deepEqual(takeTurns(queue, 0), []);
  assert.deepEqual(takeTurns(queue, -3), [], "a nonsense count takes nothing");
});

test("no count means every turn-taker, in queue order, as a copy", () => {
  const all = takeTurns(queue, null);
  assert.deepEqual(all, queue);
  assert.notEqual(all, queue);
  assert.deepEqual(takeTurns([], null), []);
});

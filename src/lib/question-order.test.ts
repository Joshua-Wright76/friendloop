import assert from "node:assert/strict";
import { test } from "node:test";
import { moveItem } from "./question-order.ts";

test("moveItem optimistically moves an item in either direction", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});

test("moveItem preserves the list for a same-position or invalid move", () => {
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], -1, 0), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, 2), ["a", "b"]);
});

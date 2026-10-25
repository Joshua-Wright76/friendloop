import assert from "node:assert/strict";
import { test } from "node:test";
import { itemsInPreferredOrder, moveItem, reorderIds } from "./question-order.ts";

test("moveItem optimistically moves an item in either direction", () => {
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
});

test("moveItem preserves the list for a same-position or invalid move", () => {
  assert.deepEqual(moveItem(["a", "b"], 1, 1), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], -1, 0), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b"], 0, 2), ["a", "b"]);
});

test("reorderIds creates one complete ordered result for long moves", () => {
  assert.deepEqual(reorderIds(["a", "b", "c", "d"], "a", 3), ["b", "c", "d", "a"]);
  assert.deepEqual(reorderIds(["a", "b", "c", "d"], "d", 0), ["d", "a", "b", "c"]);
});

test("reorderIds clamps destinations and leaves an unknown id untouched", () => {
  assert.deepEqual(reorderIds(["a", "b"], "a", 99), ["b", "a"]);
  assert.deepEqual(reorderIds(["a", "b"], "missing", 1), ["a", "b"]);
});

test("fresh question data updates fields without replacing an optimistic reorder", () => {
  const preferredIds = ["b", "a"];
  const fresh = [
    { id: "a", text: "First", skipNext: false },
    { id: "b", text: "Second", skipNext: true },
    { id: "c", text: "New", skipNext: false },
  ];

  assert.deepEqual(itemsInPreferredOrder(preferredIds, fresh), [
    { id: "b", text: "Second", skipNext: true },
    { id: "a", text: "First", skipNext: false },
    { id: "c", text: "New", skipNext: false },
  ]);
});

test("fresh question data removes archived items and appends new items", () => {
  const preferredIds = ["b", "a"];
  const fresh = [
    { id: "a", text: "a", skipNext: false },
    { id: "c", text: "c", skipNext: false },
  ];

  assert.deepEqual(itemsInPreferredOrder(preferredIds, fresh), [
    { id: "a", text: "a", skipNext: false },
    { id: "c", text: "c", skipNext: false },
  ]);
});

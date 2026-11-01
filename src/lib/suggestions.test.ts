import assert from "node:assert/strict";
import test from "node:test";
import { suggestionCredit } from "./suggestion-credit.ts";

test("a named suggestion credits its author", () => {
  assert.equal(suggestionCredit("name", "Maya"), "Maya");
});

test("an anonymous suggestion never carries a credit", () => {
  assert.equal(suggestionCredit("anonymous", "Maya"), null);
});

test("a missing name cannot produce an empty credit", () => {
  assert.equal(suggestionCredit("name", null), null);
  assert.equal(suggestionCredit("name", "   "), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_DISPLAY_NAME, cleanDisplayName } from "./names.ts";

test("tidies a name without changing how it reads", () => {
  assert.equal(cleanDisplayName("  Ada   Lovelace "), "Ada Lovelace");
  assert.equal(cleanDisplayName("Ada"), "Ada");
});

test("blank input means no name, never an empty string", () => {
  assert.equal(cleanDisplayName(""), null);
  assert.equal(cleanDisplayName("   \n\t "), null);
  assert.equal(cleanDisplayName(null), null);
  assert.equal(cleanDisplayName(undefined), null);
});

test("control characters become spaces and long names are cut", () => {
  assert.equal(cleanDisplayName("Ada\u0000Lovelace"), "Ada Lovelace");
  assert.equal(cleanDisplayName("a".repeat(MAX_DISPLAY_NAME + 20))?.length, MAX_DISPLAY_NAME);
});

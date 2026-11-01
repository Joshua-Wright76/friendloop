import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmPhrase, hashToken, newToken, safeEqual } from "./tokens.ts";

test("a token is 32 random bytes, url-safe, and never repeats", () => {
  const first = newToken();
  const second = newToken();
  assert.equal(first.length, 43); // 32 bytes base64url
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
});

test("hashing is stable and one-way-shaped", () => {
  assert.equal(hashToken("abc"), hashToken("abc"));
  assert.notEqual(hashToken("abc"), hashToken("abd"));
  assert.equal(hashToken("abc").length, 43);
  assert.ok(!hashToken("abc").includes("abc"));
});

test("safeEqual compares equal, unequal, and differently-sized strings", () => {
  assert.equal(safeEqual("same-value", "same-value"), true);
  assert.equal(safeEqual("same-value", "other-value"), false);
  assert.equal(safeEqual("short", "much-longer-value"), false);
  assert.equal(safeEqual("", ""), true);
});

test("the confirmation phrase is the name, trimmed", () => {
  assert.equal(confirmPhrase("  Friday Loop  "), "Friday Loop");
  assert.equal(confirmPhrase(""), "");
});

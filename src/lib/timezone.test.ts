import { test } from "node:test";
import assert from "node:assert/strict";
import { copy } from "./copy.ts";
import { isValidTimezone, timezoneOptions } from "./timezone.ts";

test("a resolvable zone is valid, and is trimmed", () => {
  assert.equal(isValidTimezone("Europe/Amsterdam"), true);
  assert.equal(isValidTimezone("  Asia/Kathmandu  "), true);
  assert.equal(isValidTimezone("UTC"), true);
});

test("empty, over-long, and invented zones are refused before Temporal sees them", () => {
  assert.equal(isValidTimezone(""), false);
  assert.equal(isValidTimezone("   "), false);
  assert.equal(isValidTimezone("Not/AZone"), false);
  assert.equal(isValidTimezone("Europe/Amsterdam"), true);
  assert.equal(isValidTimezone("A".repeat(65)), false);
});

test("the shortlist comes first, then everything the runtime knows", () => {
  const options = timezoneOptions();
  assert.deepEqual(options.slice(0, copy.common.timezones.length), copy.common.timezones);
  assert.equal(new Set(options).size, options.length, "no duplicates");
  assert.ok(options.includes("Asia/Tokyo"));
});

test("a runtime without supportedValuesOf still gets the curated list", (t) => {
  const original = (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf;
  t.after(() => {
    (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = original;
  });

  // Both shapes of missing API: absent, and present but throwing.
  (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = undefined;
  assert.deepEqual(timezoneOptions(), copy.common.timezones);

  (Intl as unknown as { supportedValuesOf?: unknown }).supportedValuesOf = () => {
    throw new Error("unsupported");
  };
  assert.deepEqual(timezoneOptions(), copy.common.timezones);
});

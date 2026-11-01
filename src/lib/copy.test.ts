import { test } from "node:test";
import assert from "node:assert/strict";
import { copy, text } from "./copy.ts";

test("placeholders are filled from named values", () => {
  assert.equal(text("Round {number} of {total}", { number: 4, total: 9 }), "Round 4 of 9");
  assert.equal(text("no placeholders"), "no placeholders");
  assert.equal(text("{count}", { count: 0 }), "0");
});

test("an unfilled placeholder is left visible and reported once", (t) => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: string) => errors.push(message);
  t.after(() => {
    console.error = original;
  });

  assert.equal(text("Only {missing}", {}), "Only {missing}");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /No value for \{missing\}/);

  // The same placeholder is not reported twice; the console is not a log sink.
  text("Only {missing}", {});
  assert.equal(errors.length, 1);
});

test("production renders the literal placeholder without console noise", (t) => {
  const originalEnv = process.env.NODE_ENV;
  const original = console.error;
  const errors: string[] = [];
  console.error = (message: string) => errors.push(message);
  t.after(() => {
    console.error = original;
    Object.assign(process.env, { NODE_ENV: originalEnv });
  });

  Object.assign(process.env, { NODE_ENV: "production" });
  assert.equal(text("Another {absent}", {}), "Another {absent}");
  assert.deepEqual(errors, []);
});

test("the copy document is the real one, not a fixture", () => {
  assert.ok(copy.common.brand.length > 0);
  assert.ok(copy.reply.closes.includes("{deadline}"));
});

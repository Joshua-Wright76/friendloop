import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPoll, checkPollChoices, normalizePollOptions, tallyPoll } from "./poll.ts";
import { copy } from "./copy.ts";

test("options are trimmed, blanks dropped, and a repeat kept once", () => {
  assert.deepEqual(normalizePollOptions(["  Lake ", "", "lake", "Mountains", "   "]), ["Lake", "Mountains"]);
  assert.deepEqual(normalizePollOptions([]), []);
});

test("a poll needs a prompt and two to six distinct options", () => {
  const ok = checkPoll({ prompt: "  Where to camp?  ", options: ["Lake", "Coast", "Lake"], multiple: false });
  assert.deepEqual(ok, { ok: true, poll: { prompt: "Where to camp?", options: ["Lake", "Coast"], multiple: false } });

  const many = checkPoll({ prompt: "Pick", options: ["a", "b", "c", "d", "e", "f"], multiple: true });
  assert.equal(many.ok, true);
});

test("a poll with no prompt, too few, too many, or too long an option is refused with a plain reason", () => {
  assert.deepEqual(checkPoll({ prompt: "  ", options: ["a", "b"], multiple: false }), {
    ok: false,
    error: copy.polls.errors.prompt,
  });
  assert.deepEqual(checkPoll({ prompt: "x".repeat(201), options: ["a", "b"], multiple: false }), {
    ok: false,
    error: copy.polls.errors.prompt,
  });
  assert.deepEqual(checkPoll({ prompt: "Pick", options: ["only"], multiple: false }), {
    ok: false,
    error: copy.polls.errors.optionCount,
  });
  // Seven distinct options is one too many.
  assert.deepEqual(checkPoll({ prompt: "Pick", options: ["a", "b", "c", "d", "e", "f", "g"], multiple: false }), {
    ok: false,
    error: copy.polls.errors.optionCount,
  });
  assert.deepEqual(checkPoll({ prompt: "Pick", options: ["a", "b".repeat(81)], multiple: false }), {
    ok: false,
    error: copy.polls.errors.optionLength,
  });
});

test("a single-choice poll takes at most one pick; a multi-choice poll takes any distinct set", () => {
  assert.deepEqual(checkPollChoices([1], 4, false), [1]);
  assert.deepEqual(checkPollChoices([], 4, false), []);
  assert.equal(checkPollChoices([0, 1], 4, false), null);

  assert.deepEqual(checkPollChoices([3, 0, 2], 4, true), [0, 2, 3]);
  assert.deepEqual(checkPollChoices([0, 1, 2, 3], 4, true), [0, 1, 2, 3]);
});

test("picks outside the poll, repeated, fractional, or not a list are refused whole", () => {
  assert.equal(checkPollChoices([4], 4, true), null);
  assert.equal(checkPollChoices([-1], 4, true), null);
  assert.equal(checkPollChoices([1.5], 4, true), null);
  assert.equal(checkPollChoices(["1"], 4, true), null);
  assert.equal(checkPollChoices([1, 1], 4, true), null);
  assert.equal(checkPollChoices("1", 4, true), null);
  assert.equal(checkPollChoices(null, 4, true), null);
});

test("the tally counts each option in the poll's own order, including the ones nobody picked", () => {
  assert.deepEqual(tallyPoll(["Lake", "Coast", "Hills"], [[0], [0, 2], [2]]), [
    { option: "Lake", votes: 2 },
    { option: "Coast", votes: 0 },
    { option: "Hills", votes: 2 },
  ]);
  assert.deepEqual(tallyPoll(["Lake", "Coast"], []), [
    { option: "Lake", votes: 0 },
    { option: "Coast", votes: 0 },
  ]);
});

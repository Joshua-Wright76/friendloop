import { test } from "node:test";
import assert from "node:assert/strict";
import { ownAnswerHref } from "./answer-link.ts";

const base = { participation: "contributor" as const, replyToken: "tok_abc", pausedAt: null, hasOpenRound: true };

test("a contributor with a round open answers on their own reply link", () => {
  assert.equal(ownAnswerHref(base), "/r/tok_abc");
});

test("a reader gets no link", () => {
  assert.equal(ownAnswerHref({ ...base, participation: "reader" }), null);
});

test("a paused loop takes no answers", () => {
  assert.equal(ownAnswerHref({ ...base, pausedAt: new Date() }), null);
});

test("no open round, no link", () => {
  assert.equal(ownAnswerHref({ ...base, hasOpenRound: false }), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { printHref, reactionSummary, wantsPrint, webHref } from "./print-view.ts";

test("any ?print asks for the print view, absence does not", () => {
  assert.equal(wantsPrint(""), true);
  assert.equal(wantsPrint("1"), true);
  assert.equal(wantsPrint(["", "x"]), true);
  assert.equal(wantsPrint(undefined), false);
});

test("the print address keeps the reader's token and leaves a stranger's alone", () => {
  assert.equal(printHref("/i/abc"), "/i/abc?print");
  assert.equal(printHref("/i/abc", null), "/i/abc?print");
  assert.equal(printHref("/i/abc", "t k/n"), "/i/abc?print&m=t%20k%2Fn");
  assert.equal(webHref("/i/abc"), "/i/abc");
  assert.equal(webHref("/i/abc", "tok"), "/i/abc?m=tok");
});

test("only reactions somebody gave are summarised", () => {
  assert.equal(reactionSummary([{ emoji: "❤️", count: 2 }, { emoji: "😄", count: 0 }, { emoji: "👏", count: 1 }]), "❤️ 2  👏 1");
  assert.equal(reactionSummary([{ emoji: "❤️", count: 0 }]), "");
  assert.equal(reactionSummary([]), "");
});

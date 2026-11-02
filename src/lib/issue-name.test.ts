import assert from "node:assert/strict";
import test from "node:test";
import { MAX_ISSUE_NAME, cleanIssueName, issueHeading, issueRef, issueTitle } from "./issue-name.ts";

test("a name is trimmed, flattened and capped; nothing left means unnamed", () => {
  assert.equal(cleanIssueName("  Camping   weekend \n"), "Camping weekend");
  assert.equal(cleanIssueName("tab\tand\u0000nul"), "tab and nul");
  assert.equal(cleanIssueName("   "), null);
  assert.equal(cleanIssueName(""), null);
  assert.equal(cleanIssueName(null), null);
  assert.equal(cleanIssueName(undefined), null);
  assert.equal(cleanIssueName("x".repeat(200))?.length, MAX_ISSUE_NAME);
  assert.equal(cleanIssueName(`${"x".repeat(MAX_ISSUE_NAME - 1)}  tail`), "x".repeat(MAX_ISSUE_NAME - 1));
});

test("unnamed rounds keep their number in every voice", () => {
  assert.equal(issueTitle("Round {number}", 12, null), "Round 12");
  assert.equal(issueTitle("Round {number}", 12, undefined), "Round 12");
  assert.equal(issueTitle("Round {number}", 12, "  "), "Round 12");
  assert.equal(issueRef(12, null), "round 12");
  assert.equal(issueHeading(12, null), "Round 12");
});

test("a named round uses its name everywhere", () => {
  assert.equal(issueTitle("Round {number}", 12, "Camping weekend"), "Camping weekend");
  assert.equal(issueRef(12, "Camping weekend"), "Camping weekend");
  assert.equal(issueHeading(12, "Camping weekend"), "Camping weekend");
});

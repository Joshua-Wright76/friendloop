import { test } from "node:test";
import assert from "node:assert/strict";
import { redactPath } from "./feedback-path.ts";

test("a path keeps its shape but loses anything that works as a credential", () => {
  assert.equal(redactPath("/g/abc/members"), "/g/abc/members");
  assert.equal(redactPath("/r/secret-token"), "/r/…");
  assert.equal(redactPath("/r/secret-token/suggest"), "/r/…/suggest");
  assert.equal(redactPath("/s/share-token"), "/s/…");
  assert.equal(redactPath("/i/abc?m=member-token"), "/i/abc");
  assert.equal(redactPath("/signin/confirm?token=magic"), "/signin/confirm");
});

test("an unreadable path is stored as the root, and a long one is cut", () => {
  assert.equal(redactPath("http://["), "/");
  assert.equal(redactPath(""), "/");
  assert.equal(redactPath(`/${"a".repeat(500)}`).length, 200);
});

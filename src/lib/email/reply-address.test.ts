import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeEmailAddress,
  normalizeReplyDomain,
  replyAddress,
  replyTokenFromRecipients,
} from "./reply-address.ts";

const token = `${"aB3_-".repeat(8)}aB3`;

test("reply addresses use an opaque per-recipient token", () => {
  assert.equal(replyAddress(token, "replies.friendloop.test"), `loop+${token}@replies.friendloop.test`);
  assert.equal(replyAddress("too-short", "replies.friendloop.test"), null);
  assert.equal(replyAddress(token, "not a domain"), null);
});

test("only one valid token at the configured domain is accepted", () => {
  assert.equal(
    replyTokenFromRecipients([
      "Friday Loop <other@example.test>",
      `LOOP+${token}@REPLIES.FRIENDLOOP.TEST`,
    ], "replies.friendloop.test"),
    token,
  );
  assert.equal(replyTokenFromRecipients([`loop+${token}@other.test`], "replies.friendloop.test"), null);
  assert.equal(
    replyTokenFromRecipients([`loop+${token}@replies.friendloop.test`, `loop+${"b".repeat(43)}@replies.friendloop.test`], "replies.friendloop.test"),
    null,
  );
});

test("addresses and domains are normalized without changing the token", () => {
  assert.equal(normalizeEmailAddress(" Alice <ALICE@Example.TEST> "), "alice@example.test");
  assert.equal(normalizeReplyDomain(" Replies.Friendloop.TEST. "), "replies.friendloop.test");
  assert.equal(normalizeReplyDomain("-bad.example.test"), null);
});

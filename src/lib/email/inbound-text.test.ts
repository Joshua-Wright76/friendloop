import assert from "node:assert/strict";
import test from "node:test";
import { commentFromEmail, htmlToText } from "./inbound-text.ts";

test("keeps the new reply and removes quoted history and a signature", () => {
  const body = commentFromEmail({
    text: "This made my morning.\r\n\r\n-- \r\nAlice\r\n\r\nOn Fri, Jan 9, 2026 at 9:00 AM Friday Loop <loop@example.test> wrote:\r\n> Round 2\r\n> The cat fist bump.",
  });
  assert.equal(body, "This made my morning.");
});

test("removes an attribution line that wraps before the sender address", () => {
  const body = commentFromEmail({
    text: "New reply\n\nOn Fri, Jan 9, 2026 at 9:00 AM Friday Book Club Loop <\nhello@friendloop.dev> wrote:\n> Old reply",
  });
  assert.equal(body, "New reply");
});

test("handles quoted replies and Outlook headers", () => {
  assert.equal(commentFromEmail({ text: "Me too.\n> Original answer" }), "Me too.");
  assert.equal(commentFromEmail({ text: "Me too.\nFrom: Alice <alice@example.test>\nSent: Friday, January 9, 2026\nTo: Loop\nSubject: Re: Round 2" }), "Me too.");
});

test("falls back to HTML when the message has no plain-text body", () => {
  const html = '<div>Hello &amp; goodbye<br>Second line</div><div>-- </div><div>Alice</div><blockquote>Quoted</blockquote>';
  assert.equal(commentFromEmail({ text: null, html }), "Hello & goodbye\nSecond line");
});

test("nested HTML quotes are removed with the rest of the thread", () => {
  assert.equal(
    commentFromEmail({ html: "<div>New reply</div><blockquote>Older<blockquote>Oldest</blockquote>Still older</blockquote>Trailing thread" }),
    "New reply",
  );
});

test("HTML conversion removes non-content and decodes numeric entities", () => {
  assert.equal(htmlToText('<style>p{display:none}</style><p>A &#x1f342; &#38; B</p><script>alert(1)</script>'), "A 🍂 & B");
});

test("NUL and control characters cannot reach the database", () => {
  assert.equal(commentFromEmail({ text: "Before\u0000\u0007after" }), "Beforeafter");
  assert.equal(commentFromEmail({ html: "Before&#0;&#x0;after" }), "Beforeafter");
  assert.equal(commentFromEmail({ text: "Keep\nlines\tand tabs" }), "Keep\nlines\tand tabs");
});

test("blank and quoted-only replies produce no comment", () => {
  assert.equal(commentFromEmail({ text: " \n> Only a quote\n-- \nAlice" }), "");
  assert.equal(commentFromEmail({ text: null, html: null }), "");
});

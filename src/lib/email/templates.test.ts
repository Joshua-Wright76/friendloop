import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryEmail,
  inviteEmail,
  pausedEmail,
  promptEmail,
  reminderEmail,
  signInEmail,
} from "./templates.ts";

test("sign-in email uses the requested title, copy, and button", () => {
  const email = signInEmail("https://friendloop.dev/signin/confirm?token=test");
  const copy = "This link works once and expires in 15 minutes. If you didn't request this link, feel free to ignore it.";

  assert.match(email.html, /Sign in to friendloop/);
  assert.ok(email.html.includes(copy.replace("'", "&#39;")));
  assert.match(email.html, />Sign in<\/a>/);
  assert.match(email.text, /Sign in to friendloop/);
  assert.ok(email.text.includes(copy));
});

test("every email uses Friendloop's stationery system and plain-text twin", () => {
  const emails = [
    signInEmail("https://friendloop.dev/signin"),
    inviteEmail({ groupName: "Friday Loop", inviterName: "Dev", url: "https://friendloop.dev/invite", isReader: false }),
    promptEmail({ groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, questionCount: 4, url: "https://friendloop.dev/answer", deadlineLabel: "Friday at 9:00 AM" }),
    reminderEmail({ groupName: "Friday Loop", memberName: "Dev", url: "https://friendloop.dev/answer", deadlineLabel: "Friday at 9:00 AM", remaining: 2 }),
    deliveryEmail({ groupName: "Friday Loop", issueNumber: 2, url: "https://friendloop.dev/issue", answers: [{ question: "What made you laugh?", author: "Dev", body: "The cat fist bump." }] }),
    pausedEmail({ groupName: "Friday Loop", url: "https://friendloop.dev/loop" }),
  ];

  for (const email of emails) {
    assert.match(email.html, /#fff3f5/);
    assert.match(email.html, /#fffdfa/);
    assert.match(email.html, /#cc3456/);
    assert.match(email.html, /Gaegu/);
    assert.match(email.html, /Nunito/);
    assert.match(email.html, /🍒/u);
    assert.doesNotMatch(email.html, /\{[a-zA-Z][a-zA-Z0-9]*\}/);
    assert.doesNotMatch(email.text, /\{[a-zA-Z][a-zA-Z0-9]*\}/);
    assert.ok(email.text.length > 0);
  }
});

test("invite email includes a personal note without treating it as markup", () => {
  const note = "A short hello <from me>";
  const email = inviteEmail({
    groupName: "Friday Loop",
    inviterName: "Dev",
    url: "https://friendloop.dev/invite",
    isReader: true,
    personalNote: note,
  });

  assert.ok(email.html.includes("A note from Dev: A short hello &lt;from me&gt;"));
  assert.ok(email.text.includes(`A note from Dev: ${note}`));
});

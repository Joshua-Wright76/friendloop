import assert from "node:assert/strict";
import test from "node:test";
import {
  deliveryEmail,
  emailThemeOf,
  inviteEmail,
  mentionEmail,
  pausedEmail,
  promptEmail,
  reminderEmail,
  signInEmail,
} from "./templates.ts";

test("sign-in email uses the requested title, copy, and button", () => {
  const email = signInEmail("https://friendloop.dev/signin/confirm?token=test");
  const copy = "This link works once and expires in 15 minutes. If you didn't request this link, you can ignore it.";

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
    mentionEmail({ groupName: "Friday Loop", memberName: "Dev", authorName: "Alex", issueNumber: 2, excerpt: "@Dev nice one", url: "https://friendloop.dev/i/1?m=t" }),
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

test("delivery email points to web comments without promising inbound replies", () => {
  const email = deliveryEmail({
    groupName: "Friday Loop",
    issueNumber: 2,
    url: "https://friendloop.dev/i/123",
    answers: [{ question: "What made you laugh?", author: "Dev", body: "The cat fist bump." }],
  });

  assert.match(email.html, /open the issue to read and comment/);
  assert.doesNotMatch(email.html, /reply to this email/);
});

test("a mention email names who said it, quotes it, and links to the issue", () => {
  const email = mentionEmail({
    groupName: "Friday Loop",
    memberName: "Maya",
    authorName: "Alex",
    issueNumber: 4,
    excerpt: "@Maya <b>this</b> is yours",
    url: "https://friendloop.dev/i/1?m=token",
  });

  assert.equal(email.subject, "Alex mentioned you in Friday Loop");
  assert.match(email.html, /@Maya &lt;b&gt;this&lt;\/b&gt; is yours/);
  assert.match(email.html, /See the comment/);
  assert.match(email.text, /Maya, Alex mentioned you in a comment on round 4 of Friday Loop:/);
  assert.match(email.text, /https:\/\/friendloop\.dev\/i\/1\?m=token/);
});

test("a loop with no stationery renders Gingham, and with some it wears the paper", () => {
  const plain = pausedEmail({ groupName: "Friday Loop", url: "https://friendloop.dev/loop" });
  const themed = pausedEmail({
    groupName: "Friday Loop",
    url: "https://friendloop.dev/loop",
    theme: emailThemeOf({ themePreset: "meadow", themeAccent: null, headerImageUrl: null }),
  });
  assert.match(plain.html, /#fff3f5/);
  assert.doesNotMatch(plain.html, /#f0f6ec/);
  assert.match(themed.html, /#f0f6ec/);
  assert.doesNotMatch(themed.html, /#cc3456/);
  assert.equal(themed.text, plain.text);
  assert.equal(themed.subject, plain.subject);

  const gingham = emailThemeOf({ themePreset: "gingham", themeAccent: null, headerImageUrl: null });
  assert.equal(pausedEmail({ groupName: "Friday Loop", url: "https://friendloop.dev/loop", theme: gingham }).html, plain.html);
});

test("a header picture sits above the brand line, decorative and escaped", () => {
  const theme = emailThemeOf({ themePreset: null, themeAccent: null, headerImageUrl: 'https://cdn.test/a"b.png' });
  const email = promptEmail({
    groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, questionCount: 4,
    url: "https://friendloop.dev/answer", deadlineLabel: "Friday", theme,
  });
  assert.match(email.html, /<img src="https:\/\/cdn\.test\/a&quot;b\.png" alt="" width="600"/);
  assert.ok(email.html.indexOf("<img") < email.html.indexOf("Friendloop</td>"));
  assert.equal(
    promptEmail({ groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, questionCount: 4, url: "u", deadlineLabel: "Friday" }).html.includes("<img"),
    false,
  );
});

test("a named round replaces its number in the subject, headings and sentences", () => {
  const delivery = deliveryEmail({
    groupName: "Friday Loop", issueNumber: 2, issueName: "Camping weekend", url: "https://friendloop.dev/issue",
    answers: [{ question: "q", author: "Dev", body: "b" }],
  });
  assert.equal(delivery.subject, "Friday Loop · Camping weekend");
  assert.match(delivery.html, /<h1[^>]*>Camping weekend<\/h1>/);
  assert.match(delivery.text, /Friday Loop · Camping weekend/);

  const unnamed = deliveryEmail({
    groupName: "Friday Loop", issueNumber: 2, url: "https://friendloop.dev/issue",
    answers: [{ question: "q", author: "Dev", body: "b" }],
  });
  assert.equal(unnamed.subject, "Friday Loop · round 2");
  assert.match(unnamed.html, /<h1[^>]*>Round 2<\/h1>/);

  const prompt = promptEmail({
    groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, issueName: "Camping weekend", questionCount: 2,
    url: "https://friendloop.dev/answer", deadlineLabel: "Friday",
  });
  assert.match(prompt.html, /Camping weekend is open/);
  assert.match(prompt.text, /Friday Loop Camping weekend is open/);

  const mention = mentionEmail({
    groupName: "Friday Loop", memberName: "Dev", authorName: "Alex", issueNumber: 2, issueName: "Camping weekend",
    excerpt: "hi", url: "https://friendloop.dev/i/1",
  });
  assert.match(mention.text, /a comment on Camping weekend of Friday Loop/);
});

test("the delivery email asks each question once and shows a poll's results once", () => {
  const results = "Results: The lake: 2 · The mountains: 0";
  const email = deliveryEmail({
    groupName: "Friday Loop", issueNumber: 2, url: "https://friendloop.dev/i/1",
    answers: [
      { question: "What made you laugh?", author: "Dev", body: "The cat." },
      { question: "What made you laugh?", author: "Sam", body: "The geese." },
      { question: "Where should we camp?", author: "Dev", body: "Chose: The lake", pollResults: results },
      { question: "Where should we camp?", author: "Sam", body: "Chose: The lake", pollResults: results },
    ],
  });
  assert.equal(email.html.split("What made you laugh?").length - 1, 1);
  assert.equal(email.html.split("Where should we camp?").length - 1, 1);
  assert.equal(email.html.split(results).length - 1, 1);
  assert.match(email.html, /Dev[\s\S]*The cat\.[\s\S]*Sam[\s\S]*The geese\./);
  assert.ok(email.text.includes(`What made you laugh?\nDev: The cat.\nSam: The geese.`));
  assert.ok(email.text.includes(`Where should we camp?\n${results}\nDev: Chose: The lake\nSam: Chose: The lake`));
});

test("a music pick's link says where it opens", () => {
  const email = deliveryEmail({
    groupName: "Friday Loop", issueNumber: 2, url: "https://friendloop.dev/i/1", answers: [],
    sections: [{
      title: "Music picks", emoji: null,
      answers: [
        { author: "Dev", body: "Road trip", linkUrl: "https://open.spotify.com/album/abc" },
        { author: "Sam", body: "Live set", linkUrl: "https://someone.bandcamp.com/album/x" },
      ],
    }],
  });
  assert.match(email.html, />Open in Spotify<\/a>/);
  assert.match(email.html, />Open in Bandcamp<\/a>/);
  assert.doesNotMatch(email.html, /Listen on the web issue/);
});

test("music link labels fall back to a plain one", async () => {
  const { musicLinkLabel } = await import("./templates.ts");
  assert.equal(musicLinkLabel("https://play.qobuz.com/album/1"), "Open in Qobuz");
  assert.equal(musicLinkLabel("https://example.com/song"), "Open the link");
  assert.equal(musicLinkLabel("not a url"), "Open the link");
});

test("every loop email can carry a visible 'stop emails' link in HTML and plain text; sign-in never does", () => {
  const stop = "https://friendloop.dev/u/0123abcd";
  const theme = undefined;
  const loopEmails = [
    inviteEmail({ groupName: "G", inviterName: "A", url: "https://x/r/t", isReader: false, unsubscribeUrl: stop, theme }),
    promptEmail({ groupName: "G", memberName: "M", issueNumber: 1, questionCount: 2, url: "https://x/r/t", deadlineLabel: "Fri", unsubscribeUrl: stop }),
    reminderEmail({ groupName: "G", memberName: "M", url: "https://x/r/t", deadlineLabel: "Fri", remaining: 1, unsubscribeUrl: stop }),
    mentionEmail({ groupName: "G", memberName: "M", authorName: "A", issueNumber: 1, excerpt: "hi", url: "https://x/i/1", unsubscribeUrl: stop }),
    deliveryEmail({ groupName: "G", issueNumber: 1, url: "https://x/i/1", answers: [], unsubscribeUrl: stop }),
    pausedEmail({ groupName: "G", url: "https://x/g/1", unsubscribeUrl: stop }),
  ];
  for (const email of loopEmails) {
    assert.ok(email.html.includes(`href="${stop}"`), email.subject);
    assert.ok(email.html.includes("Stop emails from this loop"), email.subject);
    assert.ok(email.text.endsWith(`Stop emails from this loop: ${stop}`), email.subject);
  }

  const withoutLink = promptEmail({ groupName: "G", memberName: "M", issueNumber: 1, questionCount: 2, url: "https://x/r/t", deadlineLabel: "Fri" });
  assert.ok(!withoutLink.html.includes("Stop emails from this loop"));
  assert.ok(!withoutLink.text.includes("Stop emails"));
  assert.ok(!signInEmail("https://x/signin").html.includes("Stop emails from this loop"));
});

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  deliveryEmail,
  emailThemeOf,
  inviteEmail,
  joinEmail,
  mentionEmail,
  pausedEmail,
  promptEmail,
  reminderEmail,
  signInEmail,
} from "./templates.ts";
import { emailPatternTiles } from "../stationery.ts";

test("sign-in email carries the link and the code, and says how long both last", () => {
  const email = signInEmail("https://friendloop.dev/signin/confirm?token=test", "042917");
  const note = "The link and code work for 4 days, as many times as you need. If you didn't ask to sign in, you can ignore this email.";

  // In the subject, so a phone's notification (and its code autofill) has it without opening the email.
  assert.equal(email.subject, "Sign in to Friendloop: 042917");
  assert.match(email.html, /Sign in to Friendloop/);
  assert.match(email.html, />Sign in<\/a>/);
  assert.match(email.html, /letter-spacing:8px;[^>]*>042917<\/td>/);
  assert.ok(email.html.includes(note.replace("'", "&#39;")));
  assert.ok(email.html.indexOf(">Sign in</a>") < email.html.indexOf(">042917<"));
  assert.match(email.text, /Sign in: https:\/\/friendloop\.dev\/signin\/confirm\?token=test/);
  assert.match(email.text, /Or type this code: 042917/);
  assert.ok(email.text.includes(note));
});

test("join email names the loop and carries the link and the code", () => {
  const email = joinEmail("Friday Loop", "https://friendloop.dev/signin/confirm?token=test", "042917");
  assert.equal(email.subject, "Join Friday Loop: 042917");
  assert.match(email.html, />Join Friday Loop<\/a>/);
  assert.match(email.html, /letter-spacing:8px;[^>]*>042917<\/td>/);
  assert.match(email.text, /Confirm and join: https:\/\/friendloop\.dev\/signin\/confirm\?token=test/);
  assert.match(email.text, /Or type this code: 042917/);
});

test("every email uses Friendloop's stationery system and plain-text twin", () => {
  const emails = [
    signInEmail("https://friendloop.dev/signin", "123456"),
    joinEmail("Friday Loop", "https://friendloop.dev/signin", "123456"),
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
    assert.match(email.html, /Noteworthy/);
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

  assert.match(email.html, /open the round to read and comment/);
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
    theme: emailThemeOf({ themePreset: "meadow", themeAccent: null, themeBackground: null, headerImageUrl: null }),
  });
  assert.match(plain.html, /#fff3f5/);
  assert.doesNotMatch(plain.html, /#f0f6ec/);
  assert.match(themed.html, /#f0f6ec/);
  assert.doesNotMatch(themed.html, /#cc3456/);
  assert.equal(themed.text, plain.text);
  assert.equal(themed.subject, plain.subject);

  const gingham = emailThemeOf({ themePreset: "gingham", themeAccent: null, themeBackground: null, headerImageUrl: null });
  assert.equal(pausedEmail({ groupName: "Friday Loop", url: "https://friendloop.dev/loop", theme: gingham }).html, plain.html);
});

test("a loop's page pattern goes out as a PNG tile on its page colour; gingham stays gradients", () => {
  const send = (themePreset: string | null, themeBackground: string | null) =>
    inviteEmail({
      groupName: "Friday Loop", inviterName: "Mars", url: "https://friendloop.dev/r/token", isReader: false,
      theme: emailThemeOf({ themePreset, themeAccent: "#123456", themeBackground, headerImageUrl: null }),
    });
  const hearts = send("lilac", "hearts");
  // The accent never changes a pattern's colour, so the tile is keyed by preset alone.
  assert.match(hearts.html, /background-color:#f5f0fb;background-image:url\('http[^']*\/patterns\/email\/hearts-lilac\.png'\);background-size:68px 68px/);
  assert.doesNotMatch(hearts.html, /linear-gradient\(90deg/);
  assert.match(send(null, "dots").html, /\/patterns\/email\/dots-gingham\.png/);
  for (const background of [null, "gingham", "javascript:alert(1)"]) {
    const html = send("lilac", background).html;
    assert.doesNotMatch(html, /patterns\/email/);
    assert.match(html, /linear-gradient\(90deg/);
  }
  assert.equal(hearts.text, send("lilac", null).text);
});

test("every pattern tile email can ask for has been rendered", () => {
  for (const tile of emailPatternTiles()) {
    assert.ok(existsSync(path.join(process.cwd(), "public", tile.path)), `${tile.path}: run node scripts/render-email-patterns.mjs`);
  }
  // No stray tiles either: the folder holds exactly what email can ask for (other files, like .DS_Store, aside).
  const pngs = readdirSync(path.join(process.cwd(), "public/patterns/email")).filter((file) => file.endsWith(".png"));
  assert.equal(pngs.length, emailPatternTiles().length);
});

test("a header picture sits above the brand line, decorative and escaped", () => {
  const theme = emailThemeOf({ themePreset: null, themeAccent: null, themeBackground: null, headerImageUrl: 'https://cdn.test/a"b.png' });
  const email = promptEmail({
    groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, questionCount: 4,
    url: "https://friendloop.dev/answer", deadlineLabel: "Friday", theme,
  });
  assert.match(email.html, /<img src="https:\/\/cdn\.test\/a&quot;b\.png" alt="" width="600"/);
  assert.ok(email.html.indexOf("<img") < email.html.indexOf("Friday Loop</td>"));
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
  assert.doesNotMatch(email.html, /Listen on the web/);
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
    assert.ok(email.text.includes(`Stop emails from this loop: ${stop}`), email.subject);
    assert.match(email.text, /Privacy: \S+\/privacy\nTerms: \S+\/terms$/, email.subject);
  }

  const withoutLink = promptEmail({ groupName: "G", memberName: "M", issueNumber: 1, questionCount: 2, url: "https://x/r/t", deadlineLabel: "Fri" });
  assert.ok(!withoutLink.html.includes("Stop emails from this loop"));
  assert.ok(!withoutLink.text.includes("Stop emails"));
  const signIn = signInEmail("https://x/signin", "123456");
  assert.ok(!signIn.html.includes("Stop emails from this loop"));
  assert.match(signIn.text, /Privacy: \S+\/privacy\nTerms: \S+\/terms$/);
});

test("a prompt shows the questions themselves, in the HTML and the plain text", () => {
  const email = promptEmail({
    groupName: "Friday Loop", memberName: "Dev", issueNumber: 3, questionCount: 2, url: "https://friendloop.dev/answer",
    deadlineLabel: "on Fri 6 Nov, 9:00 AM your time", questions: ["What made you laugh?", "Where <next>?"],
  });
  assert.match(email.html, /What made you laugh\?/);
  assert.match(email.html, /Where &lt;next&gt;\?/);
  assert.match(email.text, /- What made you laugh\?/);
});


test("a music pick in the delivery email carries its title when the provider gave one", async () => {
  const { deliveryEmail } = await import("./templates.ts");
  const base = { groupName: "Loop", issueNumber: 1, url: "https://example.com/i/1", answers: [] };
  const titled = deliveryEmail({ ...base, sections: [{ title: "Songs", emoji: null, answers: [{ author: "Alice", body: "On repeat", linkUrl: "https://open.spotify.com/track/1", linkTitle: "Rain & Song" }] }] });
  assert.match(titled.html, /Rain &amp; Song/);
  assert.match(titled.html, /Open in Spotify/);
  const untitled = deliveryEmail({ ...base, sections: [{ title: "Songs", emoji: null, answers: [{ author: "Alice", body: "", linkUrl: "https://open.spotify.com/track/1", linkTitle: null }] }] });
  assert.doesNotMatch(untitled.html, /<strong>/);
  assert.match(untitled.html, /Open in Spotify/);
});

test("a mascot goes out as a picture from the app's own address; the cherries stay the emoji they were", () => {
  const send = (themeMascot: string | null) =>
    pausedEmail({
      groupName: "Friday Loop",
      url: "https://friendloop.dev/loop",
      theme: emailThemeOf({ themePreset: null, themeAccent: null, themeBackground: null, headerImageUrl: null, themeMascot }),
    });
  const frog = send("frog");
  assert.match(frog.html, /<img src="http[^"]*\/stickers\/png\/frog\.png" alt="" width="24" height="24"/);
  assert.doesNotMatch(frog.html, /🍒/);
  assert.match(send(null).html, /🍒/);
  assert.match(send("cherries").html, /🍒/);
  assert.match(send("javascript:alert(1)").html, /🍒/);
  assert.equal(frog.text, send(null).text);
});

test("a charm sits beside the name in the answers, and never in the plain text", () => {
  const email = deliveryEmail({
    groupName: "Friday Loop",
    issueNumber: 2,
    url: "https://friendloop.dev/i/123",
    answers: [
      { question: "How was it?", author: "Alice", authorCharm: "frog", body: "Good." },
      { question: "How was it?", author: "Bob", authorCharm: "not-a-charm", body: "Fine." },
      { question: "How was it?", author: "Cleo", body: "Ok." },
    ],
    sections: [{ title: "Listening", emoji: null, answers: [{ author: "Dee", authorCharm: "moon", body: "Records." }] }],
  });
  assert.match(email.html, /Alice <img src="http[^"]*\/stickers\/png\/frog\.png" alt=""/);
  assert.match(email.html, /Dee <img src="http[^"]*\/stickers\/png\/moon\.png" alt=""/);
  assert.doesNotMatch(email.html, /not-a-charm/);
  assert.doesNotMatch(email.text, /frog|moon/);
});

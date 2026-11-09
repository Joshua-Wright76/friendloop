import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  deliveryEmail,
  emailMarksOf,
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
import { COVER_TINTS, coverOf } from "../looks.ts";
import { copy, text } from "../copy.ts";

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

/* ------------------------------ the owner's marks ----------------------------- */

const ROUND = { number: 14, deliveredAt: new Date("2026-11-08T03:00:00Z") };
const LOOP = { themePreset: null, themeMascot: "frog", timezone: "America/Los_Angeles" };
const delivered = (marks?: ReturnType<typeof emailMarksOf>) =>
  deliveryEmail({
    groupName: "Friday Loop",
    issueNumber: 14,
    url: "https://friendloop.dev/i/123",
    answers: [
      { question: "How was it?", author: "Alice", body: "Good." },
      { question: "How was it?", author: "Bob", body: "Fine." },
    ],
    theme: emailThemeOf({ themePreset: null, themeAccent: null, themeBackground: null, headerImageUrl: null, themeMascot: "frog" }),
    marks,
  });

test("a loop that chose no marks gets exactly the round email it always did", () => {
  const none = emailMarksOf({ ...LOOP }, ROUND, { number: 15, deliversAt: new Date("2026-11-15T17:00:00Z") });
  assert.deepEqual(none, { motto: null, signOff: null, nextLine: null, seal: null, divider: null });
  assert.equal(delivered(none).html, delivered().html);
  assert.equal(delivered(none).text, delivered().text);
});

test("the motto sits under the loop's name, in the hand and the accent, escaped, and in the plain text", () => {
  const email = delivered(emailMarksOf({ ...LOOP, motto: "est. 2019 <still> terrible" }, ROUND, null));
  assert.match(email.html, /Friday Loop<\/td><\/tr>\n<tr><td style="padding:0 8px 20px;font:700 17px\/1\.3 'Noteworthy'[^"]*;color:#cc3456">est\. 2019 &lt;still&gt; terrible<\/td><\/tr>/);
  assert.ok(email.html.indexOf("est. 2019") < email.html.indexOf("<h1"));
  assert.match(email.text, /^Friday Loop · round 14\nest\. 2019 <still> terrible\n/);
});

test("a wax seal tops the round's card as a picture of this mascot in this wax", () => {
  const email = delivered(emailMarksOf({ ...LOOP, sealStyle: "wax", sealColor: "moss" }, ROUND, null));
  assert.match(email.html, /<img src="http[^"]*\/seals\/wax-frog-moss\.png" alt="" width="72" height="72"/);
  assert.ok(email.html.indexOf("wax-frog-moss") < email.html.indexOf("<h1"));
  // No wax chosen is cherry; no mascot is the cherries.
  const plain = emailMarksOf({ themePreset: null, themeMascot: null, timezone: "UTC", sealStyle: "wax" }, ROUND, null);
  assert.deepEqual(plain.seal, { kind: "wax", src: "/seals/wax-cherries-cherry.png" });
});

test("a postmark is the mascot's stamp with the round and the loop's own day written beside it", () => {
  const email = delivered(emailMarksOf({ ...LOOP, sealStyle: "postmark" }, ROUND, null));
  assert.match(email.html, /<img src="http[^"]*\/seals\/stamp-frog\.png" alt="" width="52" height="62"/);
  // Delivered at 03:00 UTC on the 8th: the 7th in Los Angeles.
  assert.match(email.html, /border-radius:50%[^>]*>Round 14<br \/><span style="font-size:13px">7 NOV<\/span><br \/>2026<\/td>/);
});

test("a divider runs between answers as its preset's strip; the first answer has none", () => {
  const email = delivered(emailMarksOf({ ...LOOP, themePreset: "meadow", divider: "ricrac" }, ROUND, null));
  const strips = email.html.match(/\/dividers\/email\/ricrac-meadow\.png/g) ?? [];
  assert.equal(strips.length, 1);
  assert.match(email.html, /height:12px;[^"]*background-image:url\('http[^']*\/dividers\/email\/ricrac-meadow\.png'\);background-repeat:repeat-x/);
  assert.doesNotMatch(email.html, /border-top:1px dashed #f1dae0;padding-top:14px/);
});

test("the sign-off closes the round with the mascot and when the next one goes out, in HTML and plain text", () => {
  const next = { number: 15, deliversAt: new Date("2026-11-20T17:00:00Z") };
  const email = delivered(emailMarksOf({ ...LOOP, signOff: "xo, the <Friday> crew" }, ROUND, next));
  assert.match(email.html, /\/stickers\/png\/frog\.png[\s\S]*xo, the &lt;Friday&gt; crew<\/p><p[^>]*>Round 15 goes out Fri 20 Nov\.<\/p>/);
  assert.ok(email.html.indexOf("xo, the") > email.html.indexOf("Bob"));
  assert.ok(email.html.indexOf("xo, the") < email.html.indexOf("open the round to read and comment"));
  assert.match(email.text, /Bob: Fine\.\n\nxo, the <Friday> crew\nRound 15 goes out Fri 20 Nov\./);
  // Without a next round to promise, the sign-off stands alone.
  const alone = delivered(emailMarksOf({ ...LOOP, signOff: "xo" }, ROUND, null));
  assert.doesNotMatch(alone.html, /goes out/);
  assert.match(alone.text, /Bob: Fine\.\n\nxo$/m);
  // A next round with no sign-off says nothing extra.
  assert.equal(emailMarksOf({ ...LOOP }, ROUND, next).nextLine, null);
});

/* --------------------------- what people add themselves --------------------------- */

const SIGNED = [
  { name: "Alice", src: "https://friendloop.dev/uploads/a.png", width: 150, height: 48 },
  { name: "Bob <b>", src: "https://friendloop.dev/uploads/b.png", width: 120, height: 56 },
  { name: "Cleo", src: "https://friendloop.dev/uploads/c.png", width: 90, height: 40 },
  { name: "Dee", src: "https://friendloop.dev/uploads/d.png", width: 100, height: 50 },
];

test("nobody's line, signature or sticker leaves the round email exactly as it was", () => {
  assert.equal(deliveryEmail({ ...ROUND_INPUT(), rollCall: [], signatures: [] }).html, deliveryEmail(ROUND_INPUT()).html);
  assert.equal(deliveryEmail({ ...ROUND_INPUT(), rollCall: [], signatures: [] }).text, deliveryEmail(ROUND_INPUT()).text);
  const unstuck = ROUND_INPUT();
  unstuck.answers = unstuck.answers.map((answer) => ({ ...answer, sticker: null }));
  assert.equal(deliveryEmail(unstuck).html, deliveryEmail(ROUND_INPUT()).html);
});

test("the roll call opens the round as a plain table of names and lines, above the answers and in the text", () => {
  const email = deliveryEmail({ ...ROUND_INPUT(), rollCall: [{ name: "Alice", line: "📚 reading <Middlemarch>" }, { name: "Bob", line: "off to Lisbon" }] });
  assert.match(email.html, />Who&#39;s here this round<\/h2>/);
  assert.match(email.html, /white-space:nowrap">Alice<\/td><td[^>]*>📚 reading &lt;Middlemarch&gt;<\/td>/);
  assert.ok(email.html.indexOf("Who&#39;s here") > email.html.indexOf("<h1"));
  assert.ok(email.html.indexOf("Who&#39;s here") < email.html.indexOf("How was it?"));
  assert.match(email.text, /Who's here this round\nAlice: 📚 reading <Middlemarch>\nBob: off to Lisbon\n\nHow was it\?/);
});

test("the signed card closes the round with each signature's picture, its name under it, three to a row", () => {
  const next = { number: 15, deliversAt: new Date("2026-11-20T17:00:00Z") };
  const email = deliveryEmail({ ...ROUND_INPUT(), signatures: SIGNED, marks: emailMarksOf({ ...LOOP, signOff: "xo" }, ROUND, next) });
  assert.match(email.html, />Signed, sealed, delivered<\/h2>/);
  assert.match(email.html, />Everyone who wrote in Round 14<\/p>/);
  assert.match(email.html, /<img src="https:\/\/friendloop\.dev\/uploads\/a\.png" alt="Signed, Alice" width="150" height="48"/);
  assert.match(email.html, /alt="Signed, Bob &lt;b&gt;"[^>]*\/><div[^>]*>Bob &lt;b&gt;<\/div>/);
  assert.equal((email.html.match(/alt="Signed, /g) ?? []).length, 4);
  // Three signatures fill a row; the fourth starts the next.
  assert.match(email.html, /c\.png[^<]*<div[^>]*>Cleo<\/div><\/td><\/tr><tr><td/);
  // After the answers, before the owner's sign-off.
  assert.ok(email.html.indexOf("Signed, sealed") > email.html.indexOf("Bob</div>"));
  assert.ok(email.html.indexOf("Signed, sealed") < email.html.indexOf(">xo</p>"));
  assert.match(email.text, /Bob: Fine\.\n\nSigned, sealed, delivered: Alice, Bob <b>, Cleo, Dee\n\nxo\n/);
});

test("a sticker on an answer sits beside its author's name as a picture, and never in the plain text", () => {
  const email = deliveryEmail({
    ...ROUND_INPUT(),
    answers: [
      { question: "How was it?", author: "Alice", authorCharm: "frog", body: "Good.", sticker: "peach" },
      { question: "How was it?", author: "Bob", body: "Fine.", sticker: "../x" },
    ],
    sections: [{ title: "Listening", emoji: null, answers: [{ author: "Dee", body: "Records.", sticker: "moon" }] }],
  });
  assert.match(email.html, /Alice <img[^>]*\/stickers\/png\/frog\.png[^>]*\/> <img src="http[^"]*\/stickers\/png\/peach\.png" alt="" width="24" height="24"/);
  assert.match(email.html, /Dee <img src="http[^"]*\/stickers\/png\/moon\.png" alt="" width="24"/);
  assert.doesNotMatch(email.html, /\.\.\/x/);
  assert.doesNotMatch(email.text, /peach|moon/);
});

/* ------------------------------ round covers ------------------------------ */

test("a round without a cover reads exactly as it did", () => {
  const named = { ...ROUND_INPUT(), issueName: "Camping weekend" };
  assert.equal(deliveryEmail({ ...named, cover: null }).html, deliveryEmail(named).html);
  assert.equal(deliveryEmail({ ...named, cover: null }).text, deliveryEmail(named).text);
  // A cover on an unnamed round (a stale row) is no cover.
  const look = coverOf({ name: "x", coverSticker: "frog", coverTint: "sky" });
  assert.equal(deliveryEmail({ ...ROUND_INPUT(), cover: look }).html, deliveryEmail(ROUND_INPUT()).html);
});

test("a named round's cover opens its email: the tint as a flat band, the sticker as a picture, the name in the tint's ink", () => {
  const name = "Camping <weekend>";
  const look = coverOf({ name, coverSticker: "mushroom", coverTint: "moss" })!;
  const email = deliveryEmail({ ...ROUND_INPUT(), issueName: name, cover: look });
  const { tint, ink } = COVER_TINTS.moss;
  assert.match(email.html, new RegExp(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${tint}" style="[^"]*background:${tint}`));
  assert.match(email.html, new RegExp(`color:${ink}[^"]*">${text(copy.emails.roundHeading, { number: 14 })}</p>`));
  assert.match(email.html, /<img src="http[^"]*\/stickers\/png\/mushroom\.png" alt="" width="72" height="72"/);
  assert.match(email.html, new RegExp(`<h1 style="[^"]*color:${ink};[^"]*">Camping &lt;weekend&gt;</h1>`));
  // In place of the plain heading, not beside it, and above the answers.
  assert.equal((email.html.match(/<h1/g) ?? []).length, 1);
  assert.doesNotMatch(email.html, /border-bottom:2px dashed[^>]*>Camping/);
  assert.ok(email.html.indexOf("mushroom.png") < email.html.indexOf("How was it?"));
  // The plain text has the name as ever, and no picture.
  assert.equal(email.text, deliveryEmail({ ...ROUND_INPUT(), issueName: name }).text);
  assert.equal(email.subject, deliveryEmail({ ...ROUND_INPUT(), issueName: name }).subject);
});

test("a cover sits under the owner's seal", () => {
  const look = coverOf({ name: "Camping", coverSticker: "frog", coverTint: "plum" })!;
  const email = deliveryEmail({ ...ROUND_INPUT(), issueName: "Camping", cover: look, marks: emailMarksOf({ ...LOOP, sealStyle: "wax" }, ROUND, null) });
  assert.ok(email.html.indexOf("/seals/wax-") < email.html.indexOf(`bgcolor="${COVER_TINTS.plum.tint}"`));
});

function ROUND_INPUT() {
  return {
    groupName: "Friday Loop",
    issueNumber: 14,
    url: "https://friendloop.dev/i/123",
    answers: [
      { question: "How was it?", author: "Alice", body: "Good." },
      { question: "How was it?", author: "Bob", body: "Fine." },
    ] as Parameters<typeof deliveryEmail>[0]["answers"],
  };
}

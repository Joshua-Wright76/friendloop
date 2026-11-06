import { seedDeliveredIssue, seedLoop } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";

const AREA = "E · Reading and reacting";
const OWNER = "owner@friendloop.test";
const ALICE = "alice@friendloop.test";
const BOB = "bob@friendloop.test";
const ROUND_DATE = new Date("2026-10-30T08:00:00Z");
const member = (loop, start) => loop.members.find((item) => item.email.startsWith(start));
const HEART = `[aria-label^="React with ❤️"]`;

/** The state of the first heart button on the page. */
const heart = (t) => t.eval(`(() => {
  const el = document.querySelector(${JSON.stringify(HEART)});
  return el ? { pressed: el.getAttribute("aria-pressed"), text: el.textContent.trim() } : null;
})()`);
const waitForHeart = async (t, pressed) => {
  let state = null;
  for (let i = 0; i < 40; i++) {
    state = await heart(t);
    if (state?.pressed === pressed) return state;
    await t.pause(100);
  }
  t.check_(false, `Heart should have aria-pressed=${pressed}, was ${JSON.stringify(state)}`);
};

export const flows = {
  E1: { title: "Read a delivered issue", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedDeliveredIssue(loop, { deliveredAt: ROUND_DATE, answers: [
        { email: ALICE, body: "The cat fist bump." },
        { email: BOB, body: "A very long lunch.", questionIndex: 1 },
      ] });
      return { issue, alice: member(loop, "alice") };
    },
    run: async (t, { issue, alice }) => {
      await t.open(`/i/${issue.issueId}?m=${alice.token}`);
      await t.say("Alice opens the round from her email");
      await t.see("Round 1");
      await t.see("Delivered Friday 30 October.");
      await t.see("2 answers from the group.");
      await t.say("Every question, with each person's answer");
      await t.see("What made you laugh this week?");
      await t.see("The cat fist bump.");
      await t.say("Her own answer is marked You");
      const own = await t.eval(`[...document.querySelectorAll(".answer-card")].find((card) => card.innerText.includes("The cat fist bump."))?.innerText ?? ""`);
      t.check_(/\bYou\b/.test(own), `Alice's answer should read "You": ${own}`);
      await t.pause(800);
      await t.say("Bob's carries his name");
      await t.see("What are you looking forward to?");
      await t.see("A very long lunch.");
      const his = await t.eval(`[...document.querySelectorAll(".answer-card")].find((card) => card.innerText.includes("A very long lunch."))?.innerText ?? ""`);
      t.check_(/\bBob\b/.test(his), `Bob's answer should carry his name: ${his}`);
      await t.pause(1000);
    } },

  E2: { title: "Read by share link", area: AREA,
    staged: "Sharing is turned on and the round's share token is seeded.",
    seed: async () => {
      const loop = await seedLoop();
      await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
      const issue = await seedDeliveredIssue(loop, { deliveredAt: ROUND_DATE, shareToken: "share-token-abc123",
        answers: [{ email: ALICE, body: "Shared with the internet." }] });
      return { issue };
    },
    run: async (t) => {
      await t.signInAs(null);
      await t.say("Someone with no account opens a share link");
      await t.open("/s/share-token-abc123");
      await t.see("Round 1");
      await t.see("Shared with the internet.");
      await t.say("They can read the round, and that's all");
      await t.dontSee("Your loops");
      await t.dontSee("Sign out");
      await t.dontSee("Rounds");
      const controls = await t.eval(`({
        comment: document.querySelectorAll('textarea, [aria-label="Comment"]').length,
        post: [...document.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Post").length,
        react: document.querySelectorAll('[aria-label^="React with"]').length,
        nav: document.querySelectorAll('a[href^="/g/"], a[href^="/you"]').length,
      })`);
      t.check_(controls.comment === 0 && controls.post === 0 && controls.nav === 0, `A stranger sees controls: ${JSON.stringify(controls)}`);
      await t.tour();
      await t.pause(800);
    } },

  E3: { title: "Comment on an issue", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedDeliveredIssue(loop, { deliveredAt: ROUND_DATE, answers: [{ email: ALICE, body: "Something worth commenting on." }] });
      return { issue };
    },
    run: async (t, { issue }) => {
      const COMMENT = "This made my morning.";
      const commentAuthor = () => t.eval(`(() => {
        const para = [...document.querySelectorAll("p")].find((p) => p.textContent.includes(${JSON.stringify(COMMENT)}));
        return para ? (para.closest("li, article") ?? para.parentElement.parentElement).innerText : "";
      })()`);
      await t.signInAs(ALICE);
      await t.open(`/i/${issue.issueId}`);
      await t.see("Something worth commenting on.");
      await t.say("Alice tries to post nothing");
      await t.button("Post", { exact: true });
      await t.see("Write something first.");
      t.check_((await rows("select id from comments")).length === 0, "An empty comment must not be saved");
      await t.say("So she writes something");
      await t.fill('textarea[aria-label="Comment"]', COMMENT);
      await t.button("Post", { exact: true });
      await t.see(COMMENT);
      for (let i = 0; i < 30 && (await rows("select id from comments")).length === 0; i++) await t.pause(100);
      const saved = await rows("select body from comments");
      t.check_(saved.length === 1 && saved[0].body === COMMENT, "Exactly one comment should be saved");
      await t.say("Her own comment says You");
      const mine = await commentAuthor();
      t.check_(/\bYou\b/.test(mine) && !/\bAlice\b/.test(mine), `Should read "You": ${mine}`);
      await t.pause(1000);
      await t.say("Bob opens the round in his own session");
      await t.signInAs(BOB);
      await t.open(`/i/${issue.issueId}`);
      await t.see(COMMENT);
      const theirs = await commentAuthor();
      t.check_(/\bAlice\b/.test(theirs) && !/\bYou\b/.test(theirs), `Bob should see Alice's name: ${theirs}`);
      await t.say("For him, it's from Alice");
      await t.pause(1000);
    } },

  E4: { title: "React to an answer", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedDeliveredIssue(loop, { deliveredAt: ROUND_DATE, answers: [{ email: ALICE, body: "Something worth a heart." }] });
      return { issue };
    },
    run: async (t, { issue }) => {
      const stored = async () => (await rows("select count(*)::int as count from reactions"))[0].count;
      await t.signInAs(BOB);
      await t.open(`/i/${issue.issueId}`);
      await t.see("Something worth a heart.");
      await t.say("Bob gives Alice's answer a heart");
      await t.click(HEART);
      const on = await waitForHeart(t, "true");
      t.check_(on.text.includes("1"), `The count should be 1: ${JSON.stringify(on)}`);
      await t.pause(600);
      for (let i = 0; i < 30 && (await stored()) === 0; i++) await t.pause(100);
      t.check_(await stored() === 1, "One reaction should be stored");
      await t.say("Alice opens the same round in her own session");
      await t.signInAs(ALICE);
      await t.open(`/i/${issue.issueId}`);
      await t.see("Something worth a heart.");
      const seen = await waitForHeart(t, "false");
      t.check_(seen.text.includes("1"), `Alice should see Bob's heart: ${JSON.stringify(seen)}`);
      await t.say("She sees one heart, and it isn't marked as hers");
      await t.pause(1200);
      await t.say("Bob changes his mind");
      await t.signInAs(BOB);
      await t.open(`/i/${issue.issueId}`);
      await t.see("Something worth a heart.");
      await waitForHeart(t, "true");
      await t.click(HEART);
      const off = await waitForHeart(t, "false");
      t.check_(!off.text.includes("1"), `The count should clear: ${JSON.stringify(off)}`);
      for (let i = 0; i < 30 && (await stored()) === 1; i++) await t.pause(100);
      t.check_(await stored() === 0, "The reaction should be gone");
      await t.say("The heart is gone, and so is its count");
      await t.pause(1000);
    } },

  E5: { title: "Browse the archive", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-10-23T08:00:00Z"), answers: [{ email: ALICE, body: "Older answer." }] });
      await seedDeliveredIssue(loop, { deliveredAt: ROUND_DATE, answers: [{ email: ALICE, body: "Newer answer." }] });
      return { loop };
    },
    run: async (t, { loop }) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/issues`);
      await t.say("Every delivered round, newest first");
      await t.see("Round 2");
      await t.see("Round 1");
      const order = await t.eval(`[...document.querySelectorAll("main .card")].map((card) => card.innerText.match(/Round \\d+/)?.[0]).filter(Boolean)`);
      t.check_(order[0] === "Round 2" && order[1] === "Round 1", `Newest should be first: ${JSON.stringify(order)}`);
      await t.pause(800);
      await t.say("The older round still opens, with its own answers");
      await t.link("Read it", { nth: 1 });
      await t.expectUrl(/\/i\//);
      await t.see("Round 1");
      await t.see("Older answer.");
      await t.dontSee("Newer answer.");
      await t.pause(800);
    } },
};

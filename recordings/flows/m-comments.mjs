import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { rows } from "../../e2e/support/db.ts";
import { seedConversation } from "../../e2e/support/comments.ts";
import { find, postForm, until } from "../lib/scoped.mjs";

const AREA = "M · Richer comments";
const OWNER = "owner@friendloop.test";
const BOX = 'textarea[aria-label="Comment"]';
const answerOf = 'article';
const listbox = `document.querySelector('[role="listbox"][aria-label="People to mention"]')`;

export const flows = {
  M1: { title: "Mention a member", area: AREA,
    seed: async () => {
      const { issue, alice, bob } = await seedConversation({ readers: ["bob@friendloop.test"] });
      return { issueId: issue.issueId, alice, bob };
    },
    run: async (t, { issueId, alice, bob }) => {
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.say("Typing @ offers names. The keyboard can pick one");
      await t.click(BOX);
      await t.typeKeys("Loved this, @bo");
      await until(t, listbox, "The mention list should open");
      await t.see("Bob");
      await t.press("Enter");
      const value = () => t.eval(`document.querySelector('${BOX}').value`);
      t.check_((await value()) === "Loved this, @Bob ", `Box has "${await value()}"`);
      await t.typeKeys("see you soon");
      await t.button("Post", { exact: true });
      await t.say("It reads as a name, and stores a member reference");
      await until(t, `document.querySelector('p .mention')?.innerText === "@Bob"`, "The comment should render @Bob");
      await t.see("see you soon");
      const [saved] = await t.sql("select body from comments");
      t.check_(saved.body === `Loved this, @[${bob.id}] see you soon`, `Stored ${saved.body}`);
      await t.panel("comments.body", saved.body, { hold: 2400 });
      await t.say("Reloading sends nothing more");
      await t.reload();
      await t.see("see you soon");
      await t.say("Bob is a reader, and gets exactly one email");
      const filter = { to: bob.email, subject: "Alice mentioned you" };
      await t.openMail(filter);
      t.check_((await t.mailCount(filter)) === 1, `Bob got ${await t.mailCount(filter)} mention emails`);
      const [{ count }] = await t.sql("select count(*)::int as count from outbox where kind = 'mention'");
      await t.panel("Mailpit", `to ${bob.email}: ${await t.mailCount(filter)} message\nmention rows in outbox: ${count}`, { hold: 2000 });
      await t.say("Its link opens the issue for him");
      await t.followMailLink(`/i/${issueId}?m=${bob.token}`);
      await until(t, `document.querySelector('p .mention')?.innerText === "@Bob"`, "Bob should see the mention");
      await t.see("see you soon");
      await t.say("The list works by tap too");
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.click(BOX);
      await t.typeKeys("@");
      await until(t, listbox, "The mention list should open");
      await t.clickRole("option", "Sam");
      t.check_((await value()) === "@Sam ", `Box has "${await value()}"`);
      await t.say("Escape closes it without choosing");
      await t.typeKeys("and @b");
      await until(t, listbox, "The mention list should open");
      await t.press("Escape");
      await until(t, `!${listbox}`, "Escape should close the list");
      await t.pause(600);
    } },

  M2: { title: "Toggle comments", area: AREA,
    seed: async () => {
      const { loop, issue, alice, bob } = await seedConversation();
      const [bobReply] = await rows("select id from replies where membership_id = $1", [bob.id]);
      await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Already said.')", [issue.issueId, bob.id]);
      await rows("insert into comments (issue_id, membership_id, reply_id, body) values ($1, $2, $3, 'On the answer.')", [issue.issueId, alice.id, bobReply.id]);
      return { groupId: loop.groupId, issueId: issue.issueId, alice, bob };
    },
    run: async (t, { groupId, issueId, alice, bob }) => {
      const label = "Members can comment on delivered rounds.";
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.say("Comments on: the thread, the box, the answer's own count");
      await t.see("Already said.");
      await t.see("1 comment");
      await t.say("The owner turns commenting off");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/settings`);
      await t.clickRole("checkbox", label);
      await t.button("Save changes");
      await t.see("Saved.");
      await t.signInAs(null);
      await t.say("Every comment surface is gone");
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("Alice found a very patient goose.");
      await t.dontSee("Already said.");
      await t.dontSee("Comments");
      await t.dontSee("1 comment");
      await until(t, `!document.querySelector('${BOX}')`, "No comment box should remain");
      await t.tour({ max: 3 });
      await t.toTop();
      await t.say("For Bob as well");
      await t.open(`/i/${issueId}?m=${bob.token}`);
      await t.see("Bob rebuilt the shed.");
      await t.dontSee("Comments");
      await t.say("The write route refuses");
      const refused = await postForm(t, `/api/issue/${issueId}/comments`, { viewerToken: alice.token, body: "Sneaking one in." });
      t.check_(refused.status === 403, `Write returned ${refused.status}`);
      const [{ count }] = await t.sql("select count(*)::int as count from comments");
      t.check_(count === 2, `Comments stored: ${count}`);
      await t.panel(`POST /api/issue/…/comments`, `HTTP ${refused.status}\n${refused.text}\n\ncomments still stored: ${count}`);
      await t.say("Turned back on, everything returns");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/settings`);
      await t.clickRole("checkbox", label);
      await t.button("Save changes");
      await t.see("Saved.");
      await t.signInAs(null);
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("1 comment");
      await t.see("Already said.");
    } },

  M3: { title: "Answer threads", area: AREA,
    seed: async () => {
      const { issue, alice, bob } = await seedConversation();
      return { issueId: issue.issueId, alice, bob };
    },
    run: async (t, { issueId, alice, bob }) => {
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.say("Alice comments on Bob's answer");
      await t.see("Bob rebuilt the shed.");
      await t.click(await find(t, answerOf, "Bob rebuilt the shed.", "button", "Comment", { exact: true }));
      await t.click(`textarea[aria-label="Comment on Bob's answer"]`);
      await t.typeKeys("Was it a big shed?");
      await t.click(await find(t, answerOf, "Bob rebuilt the shed.", "button", "Post", { exact: true }));
      await t.say("It sits under his answer, and the toggle counts it");
      await until(t, `[...document.querySelectorAll("article")].some((a) => a.innerText.includes("Bob rebuilt the shed.") && a.innerText.includes("Was it a big shed?"))`, "The comment should render with Bob's answer");
      await t.see("1 comment");
      await t.say("The issue-level thread stays empty");
      await t.see("Nothing yet.");
      const leaked = await t.eval(`[...document.querySelectorAll("section")].filter((s) => s.querySelector("h2")?.innerText.trim() === "Comments").some((s) => s.innerText.includes("Was it a big shed?"))`);
      t.check_(!leaked, "The answer comment should not appear in the issue thread");
      const [saved] = await t.sql("select reply_id from comments");
      const [reply] = await t.sql("select id from replies where membership_id = $1", [bob.id]);
      t.check_(saved.reply_id === reply.id, "The comment should point at Bob's reply");
      await t.say("Bob finds it on his own answer");
      await t.open(`/i/${issueId}?m=${bob.token}`);
      await t.click(await find(t, answerOf, "Bob rebuilt the shed.", "button", "1 comment"));
      await t.see("Was it a big shed?");
      await until(t, `document.querySelector('textarea[aria-label="Comment on your answer"]')`, "Bob should get a box on his own answer");
      await t.pause(800);
    } },

  M4: { title: "Quote and attach", area: AREA,
    seed: async () => {
      const { issue, alice, bob } = await seedConversation();
      await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Anyone fancy a trip to the coast?')", [issue.issueId, bob.id]);
      const [gone] = await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Said, then unsaid.') returning id", [issue.issueId, bob.id]);
      await rows("insert into comments (issue_id, membership_id, body, quote_comment_id) values ($1, $2, 'Agreed!', $3)", [issue.issueId, alice.id, gone.id]);
      await rows("update comments set deleted_at = now() where id = $1", [gone.id]);
      return { issueId: issue.issueId, alice };
    },
    run: async (t, { issueId, alice }) => {
      const file = `form:has(${BOX}) input[type=file]`;
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.say("Bob took back a comment Alice had quoted. The quote reads as removed");
      await t.see("A comment that has since been removed.");
      await t.see("Agreed!");
      await t.dontSee("Said, then unsaid.");
      await t.say("Alice replies to Bob's other comment. It quotes into the box");
      await t.button("Reply to Bob");
      await t.see("Replying to Bob");
      await until(t, `document.activeElement?.getAttribute("aria-label") === "Comment"`, "The box should take focus");
      await t.typeKeys("Yes, and I'll bring the snacks.");
      await t.say("Something that isn't a picture is turned away");
      const notes = path.join(tmpdir(), "flrec-notes.txt");
      writeFileSync(notes, "hello");
      await t.upload(file, notes);
      await t.see("We couldn't read that photo.");
      await t.say("A real photo attaches");
      await t.upload(file, "photo3.jpg");
      await t.see("Photo: photo3.jpg");
      await t.button("Post", { exact: true });
      await t.say("The new comment shows the quote above and the photo below");
      await t.see("Yes, and I'll bring the snacks.");
      await until(t, `[...document.querySelectorAll("blockquote")].some((q) => q.innerText.includes("Bob wrote") && q.innerText.includes("Anyone fancy a trip to the coast?"))`, "The quote should render");
      await until(t, `[...document.querySelectorAll("img")].some((img) => /Photo from .* comment/.test(img.alt) && img.naturalWidth > 0)`, "The photo should render");
      await t.dontSee("Replying to Bob");
      await t.pause(600);
      await t.say("A quote can be cancelled before posting");
      await t.button("Reply to Bob");
      await t.see("Replying to Bob");
      await t.button("Cancel reply");
      await t.dontSee("Replying to Bob");
      await t.pause(600);
    } },
};

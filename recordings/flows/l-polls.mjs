import { AFTER_FIRST_SLOT, DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { rows } from "../../e2e/support/db.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { seedLoop } from "../../e2e/support/seed.ts";
import { find, until } from "../lib/scoped.mjs";

const AREA = "L · Polls";
const OWNER = "owner@friendloop.test";
const member = (loop, prefix) => loop.members.find((person) => person.email.startsWith(prefix));
const POOL = '[aria-label="Questions in round order"] > li';
const vote = (t, token, data) => fetch(t.url(`/api/reply/${token}`), {
  method: "POST", headers: { "content-type": "application/json", "x-e2e-now": AFTER_FIRST_SLOT.toISOString() }, body: JSON.stringify(data),
}).then((response) => { if (response.status !== 200) throw new Error(`Vote returned ${response.status}`); });

export const flows = {
  L1: { title: "Author a poll", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      return { groupId: loop.groupId, alice: member(loop, "alice") };
    },
    run: async (t, { groupId, alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.say("Two options that read the same are one option: the form says so");
      await t.fillLabel("Poll question", "Where should we camp?");
      await t.fillLabel("Option 1", "The lake");
      await t.fillLabel("Option 2", "the lake");
      await t.button("Add poll");
      await t.see("A poll needs a question and two to six different options.");
      t.check_((await t.sql("select 1 from questions where kind = 'poll'")).length === 0, "The bad poll should not be stored");
      await t.say("A real one: three options, more than one pick allowed");
      await t.fillLabel("Poll question", "Where should we camp?");
      await t.fillLabel("Option 1", "The lake");
      await t.fillLabel("Option 2", "The mountains");
      await t.button("Add option");
      await until(t, `document.activeElement?.name === "option"`, "The new option field should take focus");
      await t.typeKeys("The coast");
      await t.clickRole("checkbox", "People can pick more than one");
      await t.button("Add poll");
      await t.see("Poll added.");
      await t.say("It joins the pool, labelled, with its options");
      await t.see("Poll · pick any");
      await t.see("The mountains");
      await t.say("It reorders like any question");
      if (t.isMobile) {
        // Phones trade Up and Down for a Move button and a position sheet.
        await t.click(await find(t, POOL, "Where should we camp?", '[data-control="move"]'));
        await t.click(await find(t, "dialog.move-sheet", "Where should we camp?", "button", "What are you looking forward to?"));
      } else {
        await t.click(await find(t, POOL, "Where should we camp?", "button", "Up"));
      }
      await until(t, `document.querySelectorAll('${POOL}')[1]?.innerText.includes("Where should we camp?")`, "The poll should have moved up");
      const order = await t.sql("select text from questions where group_id = $1 order by position", [groupId]);
      t.check_(order[1].text === "Where should we camp?", `Stored order ${JSON.stringify(order)}`);
      await t.see("Where should we camp?");
      await t.say("The next round freezes its options");
      await t.sweep(AFTER_FIRST_SLOT);
      const [frozen] = await t.sql("select poll_options from issue_questions where kind = 'poll'");
      t.check_(frozen?.poll_options.join() === "The lake,The mountains,The coast", `Froze ${JSON.stringify(frozen)}`);
      await t.panel("issue_questions.poll_options", frozen.poll_options.join(" · "), { hold: 2000 });
      await t.say("Archiving works the same way");
      await t.reload();
      await t.click(await find(t, POOL, "Where should we camp?", "button", "Archive"));
      await t.click(await find(t, POOL, "Where should we camp?", "button", "Yes, archive"));
      await t.see("Archived.");
      await t.dontSee("Where should we camp?");
      await t.say("The open round keeps its copy");
      await t.signInAs(null);
      await t.open(`/r/${alice.token}`);
      await t.see("Where should we camp?");
      await t.see("The coast");
    } },

  L2: { title: "Answer a poll", area: AREA,
    staged: "Bob's vote is cast through the real reply API off camera, so there is a vote that could leak.",
    seed: async (t) => {
      const loop = await seedLoop({ questions: ["What made you laugh this week?"] });
      await seedPoll(loop, { text: "Where should we camp?", options: ["The lake", "The mountains", "The coast"] });
      await seedPoll(loop, { text: "Which weekends work?", options: ["June", "July", "August"], multiple: true });
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      const [{ id: campId }] = await rows("select id from issue_questions where text = 'Where should we camp?'");
      const [{ id: issueId }] = await rows("select id from issues limit 1");
      const bob = member(loop, "bob");
      await vote(t, bob.token, { action: "pollChoice", issueQuestionId: campId, choices: [0] });
      await vote(t, bob.token, { action: "submit" });
      return { alice: member(loop, "alice"), campId, issueId };
    },
    run: async (t, { alice, campId, issueId }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice sees a poll. Bob already voted, and nothing gives that away");
      await t.see("Where should we camp?");
      await t.see("Pick one");
      await t.see("Results appear when the round goes out.");
      await t.say("Tap, then change her mind");
      await t.clickRole("radio", "The lake");
      await t.see("Pick saved");
      await t.clickRole("radio", "The coast");
      await t.see("Pick saved");
      const checked = () => t.eval(`[...document.querySelectorAll('input:checked')].map((el) => el.closest("label")?.innerText.trim()).filter((name) => ["The lake", "The mountains", "The coast", "June", "July", "August"].includes(name))`);
      t.check_(JSON.stringify(await checked()) === '["The coast"]', `Picks: ${await checked()}`);
      await t.say("After a reload the last pick is the one that stuck");
      await t.reload();
      await t.see("Where should we camp?");
      t.check_(JSON.stringify(await checked()) === '["The coast"]', `Picks after reload: ${await checked()}`);
      await t.say("A pick can be cleared until delivery");
      await t.button("Clear my pick");
      await t.see("Pick cleared");
      t.check_((await checked()).length === 0, "Clearing should leave nothing picked");
      await t.clickRole("radio", "The mountains");
      await t.see("Pick saved");
      await t.say("A multiple-choice poll takes several");
      await t.see("Pick as many as you like");
      await t.clickRole("checkbox", "June");
      await t.clickRole("checkbox", "August");
      await t.clickRole("checkbox", "June");
      await t.see("Pick saved");
      const picks = await checked();
      t.check_(picks.includes("August") && !picks.includes("June"), `Picks: ${picks}`);
      await t.say("No tally anywhere on the sheet");
      await t.dontSee(" votes");
      await t.dontSee("Results ·");
      await t.see("2 of 3 answered");
      await t.button("Send answers");
      await t.see("Sent");
      await t.say("The web issue before delivery shows only her own pick");
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("Round 1");
      await t.see("The mountains");
      await t.dontSee("Results");
      await t.dontSee("Bob");
      const [row] = await t.sql("select poll_choices from replies where issue_question_id = $1 and membership_id = $2", [campId, alice.id]);
      t.check_(row.poll_choices.join() === "1", `Stored ${row.poll_choices}`);
    } },

  L3: { title: "Read a poll", area: AREA,
    staged: "The votes are cast through the real reply API off camera. The delivery sweep is the real cron endpoint with a pinned clock.",
    seed: async (t) => {
      const loop = await seedLoop({ questions: ["What made you laugh this week?"] });
      await seedPoll(loop, { text: "Which weekends work?", options: ["June", "July", "August"], multiple: true });
      await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
      await t.sweep(AFTER_FIRST_SLOT, { show: false });
      const [{ id: issueId }] = await rows("select id from issues limit 1");
      const [{ id: pollId }] = await rows("select id from issue_questions where kind = 'poll'");
      const alice = member(loop, "alice");
      const bob = member(loop, "bob");
      for (const [person, choices] of [[alice, [0, 2]], [bob, [2]]]) {
        await vote(t, person.token, { action: "pollChoice", issueQuestionId: pollId, choices });
        await vote(t, person.token, { action: "submit" });
      }
      return { alice, issueId };
    },
    run: async (t, { alice, issueId }) => {
      await t.clock(DELIVERY_DAY);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice and Bob voted. The round goes out");
      const report = await t.sweep(DELIVERY_DAY);
      t.check_(report.delivered === 1, `Delivered ${report.delivered}`);
      await t.say("Everyone's pick sits next to their name, with a tally");
      await t.open(`/i/${issueId}?m=${alice.token}`);
      await t.see("Which weekends work?");
      await t.see("Results · 2 votes");
      const named = (root) => t.eval(`[...document.querySelectorAll('${root}[aria-label^="Chose"]')].map((el) => el.getAttribute("aria-label"))`);
      const picks = await named("");
      t.check_(picks.includes("Chose June, August") && picks.includes("Chose August"), `Picks ${picks}`);
      await t.scroll(260);
      await t.pause(1000);
      await t.say("A share-link visitor sees the same");
      const [{ share_token: share }] = await t.sql("select share_token from issues where id = $1", [issueId]);
      await t.signInAs(null);
      await t.open(`/s/${share}`);
      await t.see("Results · 2 votes");
      await t.see("Alice");
      t.check_((await named("")).includes("Chose June, August"), "Share page should show the picks");
      await t.pause(600);
      await t.say("The email says the same in words");
      await t.openMail({ to: alice.email, subject: "round 1" });
      const body = `${t.lastMail.HTML}\n${t.lastMail.Text}`;
      t.check_(body.includes("Chose: June, August"), "The email should carry the picks");
      t.check_(body.includes("Results: June: 1 · July: 0 · August: 2"), "The email should carry the results");
      await t.panel("delivery email", "Chose: June, August\nResults: June: 1 · July: 0 · August: 2", { hold: 2400 });
    } },
};

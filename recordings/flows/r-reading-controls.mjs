import { addMember, seedLoop, seedOpenIssue } from "../../e2e/support/seed.ts";
import { HOUR } from "../../e2e/support/clock.ts";
import { rows } from "../../e2e/support/db.ts";
import { seedReading } from "../../e2e/support/reading.ts";

const AREA = "R · Reading and delivery controls";
const OPENED = new Date("2026-01-02T08:00:00Z");
const OWNER = "owner@friendloop.test";
const ALICE = "alice@friendloop.test";
const BOB = "bob@friendloop.test";

/** Round titles listed as cards: a heading line like "Round 3 is open now" doesn't count. */
const listed = (t) => t.eval(`[...document.querySelectorAll("main ul li.card > div > p:first-child")].map((p) => p.textContent.trim())`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const flows = {
  R2: { title: "Find one member's answers", area: AREA,
    seed: async () => {
      const world = await seedReading();
      await rows("update groups set share_enabled = true where id = $1", [world.loop.groupId]);
      await rows("update issues set share_token = 'r2-share-token' where id = $1", [world.first.issueId]);
      return world;
    },
    run: async (t, world) => {
      const { loop, first, second, alice, bob } = world;
      const rounds = `/g/${loop.groupId}/issues`;
      await t.signInAs(OWNER);
      await t.say("Every round is listed until someone is chosen");
      await t.open(rounds);
      t.check_((await listed(t)).length === 3, "Expected three rounds");
      await t.say("Narrow to the rounds Alice answered in");
      await t.select('select[name="member"]', alice.id);
      await t.button("Show rounds");
      await t.expectUrl(new RegExp(`member=${alice.id}`));
      await t.see("Showing rounds Alice answered in.");
      t.check_(same(await listed(t), ["Round 1"]), `Listed: ${await listed(t)}`);
      await t.say("“Read it” opens that round on her answers");
      await t.link("Read it: Round 1");
      await t.expectUrl(new RegExp(`/i/${first.issueId}\\?by=${alice.id}`));
      await t.see("Showing only Alice's answers.");
      await t.see("Alice on the goose.");
      await t.see("Alice fixed the gate.");
      await t.dontSee("Bob on the goose.");
      await t.say("The way back is a plain link");
      await t.link("Show everyone");
      await t.see("Bob on the goose.");
      await t.say("Inside a round, a row of links isolates one person");
      await t.link("Bob", { exact: true });
      await t.see("Bob looks forward to a nap.");
      await t.dontSee("Alice on the goose.");
      const current = await t.eval(`document.querySelector('nav[aria-label="Reading this round"] a[aria-current="true"]').textContent`);
      t.check_(current.includes("Bob"), `Current link: ${current}`);
      await t.say("Or read the round by person, one card per author");
      await t.link("Everyone", { exact: true });
      await t.expectUrl(/^(?!.*by=)/);
      await t.link("By person");
      await t.see("Alice fixed the gate.");
      const people = await t.eval(`[...document.querySelectorAll("section[aria-label] > h2")].map((h) => h.textContent)`);
      t.check_(people.length === 2 && people[0].endsWith("Alice") && people[1].endsWith("Bob"), `Cards: ${people}`);
      await t.tour({ dwell: 400, max: 4 });
      await t.say("Someone with no delivered answers gets a plain empty message and a way out");
      await t.open(rounds);
      await t.select('select[name="member"]', loop.members.find((m) => m.email === OWNER).id);
      await t.button("Show rounds");
      await t.see("Sam hasn't answered in a delivered round yet.");
      await t.link("Show every round");
      await t.expectUrl(/\/issues$/);
      await t.say("A made-up id in the address is no filter");
      await t.open(`${rounds}?member=99999999-9999-4999-8999-999999999999`);
      t.check_((await listed(t)).length === 3, "A made-up id filtered the list");
      await t.dontSee("answered in.");
      await t.say("A person who wrote nothing in this round reads as everyone");
      await t.open(`/i/${second.issueId}?by=${alice.id}`);
      await t.see("Bob alone in round two.");
      await t.dontSee("Showing only");
      await t.say("The share link always shows the whole round");
      await t.signInAs(null);
      await t.open(`/s/r2-share-token?by=${alice.id}`);
      await t.see("Bob on the goose.");
      await t.see("Alice on the goose.");
      await t.say("So does the print view");
      await t.open(`/i/${first.issueId}?print&m=${alice.token}&by=${bob.id}`);
      await t.see("Alice on the goose.");
      await t.see("Bob on the goose.");
    } },

  R3: { title: "Reminder preferences", area: AREA,
    staged: "The clock is pinned and the cron sweep is triggered by hand, so the day before delivery arrives in seconds. The refused POSTs are made outside the page.",
    seed: async () => {
      const loop = await seedLoop();
      const issue = await seedOpenIssue(loop, { openedAt: OPENED });
      const reader = await addMember(loop, { email: "reader@friendloop.test", name: "Rae", participation: "reader" });
      return { loop, issue, reader };
    },
    run: async (t, { loop, issue, reader }) => {
      const alice = loop.members.find((member) => member.email === ALICE);
      const bob = loop.members.find((member) => member.email === BOB);
      const prefs = async () => Object.fromEntries((await t.sql("select email, reminder_preference from memberships where group_id = $1", [loop.groupId])).map((row) => [row.email, row.reminder_preference]));
      const pref = async (member) => (await prefs())[member.email];
      const until = async (member, want) => {
        for (let i = 0; i < 30 && (await pref(member)) !== want; i++) await t.pause(100);
        t.check_((await pref(member)) === want, `${member.email} never saved ${want}`);
      };
      await t.clock(new Date(OPENED.getTime() + HOUR));
      await t.say("Alice opens her answer page: the reminder choice is at the bottom");
      await t.open(`/r/${alice.token}`);
      await t.see("Remind me");
      await t.say("She picks no reminders, and it saves as she chooses");
      await t.clickRole("radio", "No reminders");
      await t.see("Saved.");
      await until(alice, "none");
      await t.see("nudge you by hand");
      await t.say("Reload: the choice stuck");
      await t.reload();
      await t.see("Remind me");
      t.check_(await t.eval(`[...document.querySelectorAll("input[type=radio]")].find((r) => r.labels[0]?.textContent.includes("No reminders")).checked`), "No reminders did not stick");
      await t.say("Bob chooses only the last reminder");
      await t.open(`/r/${bob.token}`);
      await t.see("Remind me");
      await t.clickRole("radio", "Only the last reminder");
      await t.see("Saved.");
      await until(bob, "last");
      await t.say("Refused: a reader, a stranger, a bad value");
      const send = (token, preference, title) => t.request("POST", `/api/reply/${token}`, { body: { action: "reminders", preference }, title });
      const before = await prefs();
      const refused = [
        (await send(reader.token, "none", "POST as a reader, preference none")).status,
        (await send("not-a-token", "none", "POST with a made-up token")).status,
        (await send(alice.token, "weekly", "POST with preference weekly")).status,
      ];
      t.check_(same(refused, [403, 404, 400]), `Statuses: ${refused}`);
      t.check_(same(before, await prefs()), "A refused POST changed a preference");
      await t.say("Opening a page changes nothing either");
      await fetch(`${t.stack.app}/r/${alice.token}`);
      t.check_((await pref(alice)) === "none", "A GET changed a preference");
      await t.panel("reminder_preference", Object.entries(await prefs()).map(([email, value]) => `${email.padEnd(26)}${value}`).join("\n"));
      await t.say("The day before delivery, the sweep sends the reminder");
      const at = new Date(issue.deliversAt.getTime() - 24 * HOUR);
      const swept = await t.sweep(at);
      t.check_(swept.reminded === 2, `Reminded ${swept.reminded}`);
      await t.waitForMail({ to: BOB });
      await t.waitForMail({ to: OWNER });
      t.check_((await t.mailCount({ to: ALICE })) === 0, "Alice was reminded despite choosing none");
      await t.say("Bob and the owner got it. Alice did not");
      const mail = await t.openMail({ to: BOB });
      t.check_(mail.HTML.includes("switch these reminders off at the bottom of your answer page"), "The email doesn't point at the control");
      await t.panel("the reminder's own words", "...switch these reminders off at the bottom of your answer page...", { hold: 2000 });
      await t.say("Run the sweep again: nothing repeats");
      const again = await t.sweep(at);
      t.check_(again.reminded === 0, `A second sweep reminded ${again.reminded}`);
      await t.say("The owner's nudge by hand still reaches Alice");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}`);
      await t.button("Send a nudge");
      await t.see("3 nudges sent.");
      await t.waitForMail({ to: ALICE });
      await t.openMail({ to: ALICE }, { inbox: true });
      await t.see("Friday Loop");
    } },
};

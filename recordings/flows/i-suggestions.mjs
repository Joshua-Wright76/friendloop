import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { seedLoop, seedOpenIssue, seedReplies } from "../../e2e/support/seed.ts";
import { seedSuggestion } from "../../e2e/support/suggestions.ts";
import { find, retype } from "../lib/scoped.mjs";

const AREA = "I · Suggested questions";
const OWNER = "owner@friendloop.test";
const member = (loop, prefix) => loop.members.find((person) => person.email.startsWith(prefix));
const openRound = (loop) => seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });

export const flows = {
  I1: { title: "Suggest a question", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      await openRound(loop);
      return { groupId: loop.groupId, alice: member(loop, "alice") };
    },
    run: async (t, { groupId, alice }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${alice.token}`);
      await t.say("Alice is answering this round. The sheet invites a suggestion");
      await t.see("Have a question for the group?");
      await t.link("Suggest one");
      await t.expectUrl(/\/suggest$/);
      await t.say("She writes a question and picks how her name shows");
      await t.fillLabel("Your question", "Who taught the dog to open doors?");
      await t.see("Ask by name");
      await t.see("Keep me anonymous");
      await t.clickRole("radio", "Ask by name");
      await t.button("Send suggestion");
      await t.say("A quiet confirmation");
      await t.see("Suggestion sent");
      await t.pause(800);
      await t.say("Web only: Mailpit stays empty");
      const [{ count }] = await rows("select count(*)::int as count from outbox");
      t.check_(count === 0 && (await t.mailCount()) === 0, `A suggestion should send no email; outbox has ${count}`);
      await t.open(`${t.stack.mailpit}/`);
      await t.panel("email sent for this suggestion", `outbox rows: ${count}\nMailpit messages: ${await t.mailCount()}`, { hold: 2200 });
      await t.say("It is already waiting in the owner's queue");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.see("Suggested questions");
      await t.see("from Alice");
      const value = await t.eval(`document.querySelector('form input[name="text"]').value`);
      t.check_(value === "Who taught the dog to open doors?", `Queue shows "${value}"`);
    } },

  I2: { title: "Owner reviews the queue", area: AREA,
    seed: async () => {
      const loop = await seedLoop();
      await openRound(loop);
      await seedSuggestion({ loop, questionText: "Who taught the dog to open doors?", memberEmail: member(loop, "alice").email, status: "pending" });
      await seedSuggestion({ loop, questionText: "What are you reading right now?", memberEmail: member(loop, "bob").email, authorDisplay: "anonymous", status: "pending" });
      return { groupId: loop.groupId, alice: member(loop, "alice") };
    },
    run: async (t, { groupId, alice }) => {
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.say("The owner sees who asked what, and who asked to stay anonymous");
      await t.see("Suggested questions");
      await t.see("from Alice");
      await t.see("from Bob");
      await t.see("anonymous");
      await t.say("She tweaks Alice's wording, then adds it to the pool");
      const row = 'section[aria-label="Suggested questions"] li';
      const field = await find(t, row, "from Alice", 'input[name="text"]');
      await retype(t, field, "Who taught the dog to open doors, and when?");
      await t.click(await find(t, row, "from Alice", "button", "Add to your questions"));
      await t.see("Suggestion added to your questions.");
      await t.see("Who taught the dog to open doors, and when?");
      const [stored] = await rows(
        `select q.text, m.name as asked_by from question_suggestions s
         join questions q on q.id = s.accepted_question_id join memberships m on m.id = s.membership_id
         where s.status = 'accepted'`,
      );
      t.check_(stored?.text === "Who taught the dog to open doors, and when?" && stored.asked_by === "Alice", `Stored ${JSON.stringify(stored)}`);
      await t.panel("question_suggestions → questions", `pool text: ${stored.text}\nattributed to: ${stored.asked_by} (membership ${alice.id.slice(0, 8)})`, { hold: 2600 });
      await t.say("Bob's one is a decline: it leaves the queue");
      await t.button("Decline");
      await t.see("Suggestion declined.");
      await t.dontSee("Suggested questions");
      await t.dontSee("What are you reading right now?");
    } },

  I3: { title: "Suggested question in an issue", area: AREA,
    staged: "The two accepted suggestions and Alice's answer are seeded. The sweeps are the real cron endpoint with a pinned clock.",
    seed: async () => {
      const loop = await seedLoop();
      await seedSuggestion({ loop, questionText: "What made you laugh this week?", memberEmail: member(loop, "alice").email });
      await seedSuggestion({ loop, questionText: "What are you looking forward to?", memberEmail: member(loop, "bob").email, authorDisplay: "anonymous" });
      return { alice: member(loop, "alice"), bob: member(loop, "bob") };
    },
    run: async (t, { alice, bob }) => {
      await t.open(`/r/${alice.token}`);
      await t.say("Alice asked by name, Bob anonymously. The round opens");
      await t.sweep(new Date("2026-01-02T08:00:00Z"), { show: true });
      const snapshot = await t.sql("select text, suggested_by from issue_questions order by position");
      t.check_(snapshot[0].suggested_by === "Alice" && snapshot[1].suggested_by === null, `Snapshot ${JSON.stringify(snapshot)}`);
      const [first] = await t.sql("select id from issues order by number asc limit 1");
      await seedReplies({ issueId: first.id, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "The cat fist bump." }] });
      await seedReplies({ issueId: first.id, membershipId: bob.id, answers: [{ text: "What are you looking forward to?", body: "The first warm evening." }] });
      await t.say("A week later the round goes out");
      await t.sweep(new Date("2026-01-09T08:00:00Z"));
      await t.clock(DELIVERY_DAY);
      await t.open(`/i/${first.id}?m=${alice.token}`);
      await t.say("Alice's question carries her credit");
      await t.see("asked by Alice");
      await t.say("Bob's anonymous one carries none");
      await t.see("What are you looking forward to?");
      await t.dontSee("asked by Bob");
      await t.say("Alice changes her name later. The past issue keeps its credit");
      await rows("update memberships set name = 'Alicia' where id = $1", [alice.id]);
      await t.reload();
      await t.see("asked by Alice");
      await t.dontSee("asked by Alicia");
    } },

  I4: { title: "Readers are walled off", area: AREA,
    seed: async () => {
      const loop = await seedLoop({ members: [
        { email: "alice@friendloop.test", name: "Alice" },
        { email: "reader@friendloop.test", name: "Rita", participation: "reader" },
      ] });
      await openRound(loop);
      return { alice: member(loop, "alice"), rita: member(loop, "reader") };
    },
    run: async (t, { alice, rita }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.say("Rita is a reader. Her link offers no way to suggest");
      await t.open(`/r/${rita.token}`);
      await t.dontSee("Suggest one");
      await t.pause(600);
      await t.say("Going straight to the suggest address is a wall");
      await t.open(`/r/${rita.token}/suggest`);
      await t.see("Not available here");
      await t.dontSee("Your question");
      await t.dontSee("What made you laugh");
      await t.say("The write route refuses too");
      const refused = await t.request("POST", `/api/suggest/${rita.token}`, { body: { text: "Why is the sky blue?", authorDisplay: "name" } });
      t.check_(refused.status === 403, `Reader POST returned ${refused.status}`);
      await t.say("A revoked link gets the replaced-link screen, with no form");
      await t.open(`/r/${alice.token}-rotated/suggest`);
      await t.see("This link doesn't work anymore");
      await t.dontSee("Your question");
      await t.dontSee("Friday Loop");
      await t.pause(900);
    } },

  I5: { title: "from_you stays quiet", area: AREA,
    seed: async () => {
      const loop = await seedLoop({ mode: "from_you", members: [] });
      return { groupId: loop.groupId, token: loop.ownerToken };
    },
    run: async (t, { groupId, token }) => {
      await t.clock(AFTER_FIRST_SLOT);
      await t.open(`/r/${token}`);
      await t.say("A from-you loop opens a round. The prompt email arrives");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.openMail({ to: OWNER });
      t.check_(!/suggest/i.test(`${t.lastMail.HTML} ${t.lastMail.Text}`), "The prompt email mentions suggesting");
      await t.panel("prompt email", 'contains "suggest": no', { hold: 2000 });
      await t.say("The owner's reply sheet has no suggest link");
      await t.open(`/r/${token}`);
      await t.see("What made you laugh this week?");
      await t.dontSee("Suggest one");
      await t.dontSee("Have a question for the group");
      await t.say("Neither does the dashboard");
      await t.signInAs(OWNER);
      await t.open(`/g/${groupId}/questions`);
      await t.see("What made you laugh this week?");
      await t.dontSee("Suggested questions");
      await t.say("The address itself leads nowhere");
      await t.open(`/r/${token}/suggest`);
      await t.see("Not available here");
      await t.dontSee("Your question");
    } },
};

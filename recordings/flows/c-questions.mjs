import { seedDeliveredIssue, seedLoop, seedReplies } from "../../e2e/support/seed.ts";
import { rows } from "../../e2e/support/db.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY } from "../../e2e/support/clock.ts";
import { QUESTION_PACKS } from "../../src/lib/question-packs.ts";

const AREA = "C · Questions";
const OWNER = "owner@friendloop.test";
const LAUGH = "What made you laugh this week?";
const FORWARD = "What are you looking forward to?";

const member = (loop, prefix) => loop.members.find((item) => item.email.startsWith(prefix));
const pack = (name) => QUESTION_PACKS.find((item) => item.name === name).questions;
const poolTexts = async (t, groupId) => (await t.sql(`select text from questions where group_id = $1 and archived_at is null order by position`, [groupId])).map((row) => row.text);
const roundTexts = async (t, groupId, number) => (await t.sql(`select iq.text from issue_questions iq join issues i on i.id = iq.issue_id where i.group_id = $1 and i.number = $2 order by iq.position`, [groupId, number])).map((row) => row.text);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const POOL_LIST = `document.querySelector('ol[aria-label="Questions in round order"]')`;
/** The order questions appear in the pool's list (the packs below repeat some wording) or on a reply sheet. */
const onPageOrder = (t, texts) => t.eval(`(() => { const page = (${POOL_LIST} ?? document.body).innerText; return ${JSON.stringify(texts)}.map((text) => page.indexOf(text)); })()`);
const shown = async (t, first, second) => {
  const [a, b] = await onPageOrder(t, [first, second]);
  t.check_(a >= 0 && b >= 0 && a < b, `Expected "${first}" before "${second}" (${a}, ${b})`);
};
/** Fold a pack open or shut. A plain name also matches questions that mention the word. */
const togglePack = (t, name) => t.click(`section[aria-label="${name}"] .pack-toggle`);
const openPool = async (t, loop) => {
  await t.clock(new Date(BEFORE_FIRST_SLOT));
  await t.signInAs(OWNER);
  await t.open(`/g/${loop.groupId}/questions`);
};

export const flows = {
  C1: { title: "Add a custom question", area: AREA,
    staged: "The clock is pinned so the sweep can open the next round on demand.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      const added = "What did you learn this week?";
      await openPool(t, loop);
      await t.say("The owner writes a new question");
      await t.fill('#question-form input[name="text"]', added);
      await t.button("Add question");
      await t.see("Question added.");
      await t.say("It joins the end of the pool");
      await t.see(added);
      await shown(t, FORWARD, added);
      const pool = await poolTexts(t, loop.groupId);
      t.check_(pool[pool.length - 1] === added, "New question should be last");
      await t.say("The next round asks it");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(null);
      await t.open(`/r/${member(loop, "alice").token}`);
      await t.see(added);
      t.check_((await roundTexts(t, loop.groupId, 1)).includes(added), "The next round should include it");
    } },

  C2: { title: "Reorder questions", area: AREA,
    staged: "The clock is pinned so the sweep can open the next round on demand.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      await openPool(t, loop);
      await t.say(`"${LAUGH}" comes first for now`);
      await shown(t, LAUGH, FORWARD);
      await t.say("Move it down one");
      if (t.isMobile) {
        await t.button(`Move: ${LAUGH}`);
        await t.see("Move question");
        await t.button(`2.`);
      } else {
        await t.button(`Down: ${LAUGH}`);
      }
      await t.pause(800);
      await shown(t, FORWARD, LAUGH);
      await t.say("The new order sticks after a reload");
      await t.reload();
      await shown(t, FORWARD, LAUGH);
      t.check_(same(await poolTexts(t, loop.groupId), [FORWARD, LAUGH]), "Saved order should be swapped");
      await t.say("And the next round asks them in that order");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      await t.signInAs(null);
      await t.open(`/r/${member(loop, "alice").token}`);
      await t.see(FORWARD);
      await shown(t, FORWARD, LAUGH);
      t.check_(same(await roundTexts(t, loop.groupId, 1), [FORWARD, LAUGH]), "Round should use the new order");
    } },

  C3: { title: "Archive a question", area: AREA,
    staged: "The clock is pinned and last week's round is seeded.",
    seed: async () => {
      const loop = await seedLoop();
      const deliveredAt = new Date("2026-01-30T08:00:00Z");
      const issue = await seedDeliveredIssue(loop, { deliveredAt, answers: [{ email: "alice@friendloop.test", body: "the cat" }] });
      // The sweep schedules from this, so the next round is the week after, not a catch-up from January.
      await rows("update groups set last_slot_at = $1 where id = $2", [deliveredAt.toISOString(), loop.groupId]);
      return { loop, issue };
    },
    run: async (t, { loop, issue }) => {
      await t.clock(new Date("2026-02-02T10:00:00Z"));
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say(`The owner archives "${LAUGH}"`);
      await t.see(LAUGH);
      await t.button(`Archive ${LAUGH}`);
      await t.say("Archiving asks first");
      await t.button("Yes, archive");
      await t.see("Archived.");
      await t.say("It's gone from the pool");
      const listed = await t.eval(`${POOL_LIST}.innerText`);
      t.check_(!listed.includes(LAUGH) && listed.includes(FORWARD), `Pool list still shows it: ${listed}`);
      await t.say("Last week's round still shows it, word for word");
      await t.open(`/i/${issue.issueId}`);
      await t.see(LAUGH);
      await t.see("the cat");
      await t.say("And the next round doesn't ask it");
      const nextSlot = new Date("2026-02-06T08:05:00Z");
      await t.sweep(nextSlot);
      await t.clock(nextSlot);
      await t.signInAs(null);
      await t.open(`/r/${member(loop, "alice").token}`);
      await t.see(FORWARD);
      await t.dontSee(LAUGH);
      t.check_(same(await roundTexts(t, loop.groupId, 2), [FORWARD]), "Next round should leave it out");
      t.note("Dates here sit inside the loop's first 26 weeks on purpose: past that, dueSlot in src/lib/schedule.ts caps its slot index at 26 and the sweep stops opening rounds for the loop.");
    } },

  C4: { title: "Choose the next issue's questions", area: AREA,
    staged: "The clock is pinned so the sweep can open two rounds a week apart.",
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      await openPool(t, loop);
      await t.say("The owner sits one question out, for the next round only");
      await t.button(`Skip next round: ${LAUGH}`);
      await t.see("Sitting out the next round");
      await t.say("Round 1 opens without it");
      await t.sweep(AFTER_FIRST_SLOT);
      await t.clock(new Date(AFTER_FIRST_SLOT));
      const alice = member(loop, "alice").token;
      await t.signInAs(null);
      await t.open(`/r/${alice}`);
      await t.see(FORWARD);
      await t.dontSee(LAUGH);
      t.check_(same(await roundTexts(t, loop.groupId, 1), [FORWARD]), "Round 1 should skip it");
      await t.say("It's still in the pool");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.see(LAUGH);
      t.check_((await poolTexts(t, loop.groupId)).includes(LAUGH), "The question should stay in the pool");
      await t.say("And round 2 asks it again");
      const later = new Date(AFTER_FIRST_SLOT.getTime() + 7 * DAY);
      await t.sweep(later);
      await t.clock(later);
      await t.signInAs(null);
      await t.open(`/r/${alice}`);
      await t.see(LAUGH);
      await t.see(FORWARD);
      t.check_(same(await roundTexts(t, loop.groupId, 2), [LAUGH, FORWARD]), "Round 2 should ask both");
    } },

  C5: { title: "Rotate questions", area: AREA,
    staged: "The clock is pinned and a reply is seeded each week, so the sweep can open round after round without the loop pausing itself.",
    seed: async () => {
      const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"].map((label, index) => `${label}: ${[LAUGH, FORWARD, "What surprised you?", "What did you cook?", "Who did you see?"][index]}`);
      const rotating = await seedLoop({ questions: QUESTIONS });
      return { rotating, QUESTIONS };
    },
    run: async (t, { rotating, QUESTIONS }) => {
      const [Q1, Q2, Q3, Q4, Q5] = QUESTIONS;
      await openPool(t, rotating);
      await t.say("The owner asks for two questions a round");
      await t.pick("Questions per round", "2");
      await t.button("Save question count");
      await t.see("Questions per round updated.");
      const alice = member(rotating, "alice");
      const round = async (number, at, want) => {
        await t.sweep(at, { show: false });
        await t.clock(at);
        await t.signInAs(null);
        await t.open(`/r/${alice.token}`);
        await t.say(`Round ${number} asks ${want.map((text) => text.slice(0, 2)).join(" and ")}`);
        for (const text of want) await t.see(text, { hold: 300 });
        await t.pause(800);
        t.check_(same(await roundTexts(t, rotating.groupId, number), want), `Round ${number}: ${JSON.stringify(await roundTexts(t, rotating.groupId, number))}`);
        const [{ id }] = await t.sql(`select id from issues where group_id = $1 and number = $2`, [rotating.groupId, number]);
        await seedReplies({ issueId: id, membershipId: rotating.members[0].id, answers: [{ text: want[0], body: "Answer" }] });
      };
      await round(1, AFTER_FIRST_SLOT, [Q1, Q2]);
      await round(2, new Date(AFTER_FIRST_SLOT.getTime() + 7 * DAY), [Q3, Q4]);
      await round(3, new Date(AFTER_FIRST_SLOT.getTime() + 14 * DAY), [Q5, Q1]);

      // Made only now: the sweep opens rounds for every loop it finds.
      const sendNow = await seedLoop({ name: "Send-now Loop", questions: QUESTIONS });
      const everything = await seedLoop({ name: "Whole-pool Loop", questions: QUESTIONS });
      await t.sql(`update groups set questions_per_round = 2 where id = $1`, [sendNow.groupId]);
      await t.clock(new Date(BEFORE_FIRST_SLOT));
      await t.signInAs(OWNER);
      await t.open(`/g/${sendNow.groupId}`);
      await t.say("Send now uses the same rotation");
      await t.button("Send now");
      await t.see("Round 1 is open and everyone");
      const sent = await roundTexts(t, sendNow.groupId, 1);
      const [{ question_cursor: cursor }] = await t.sql(`select question_cursor from groups where id = $1`, [sendNow.groupId]);
      t.check_(same(sent, [Q1, Q2]) && cursor === 2, `Send now: ${JSON.stringify(sent)}, cursor ${cursor}`);
      await t.panel("Round 1 of this loop", `${sent.join("\n")}\ncursor is now ${cursor}`);

      await t.open(`/g/${everything.groupId}/questions`);
      await t.say(`"All questions" keeps the original behaviour`);
      await t.see("All questions");
      await t.open(`/g/${everything.groupId}`);
      await t.button("Send now");
      await t.see("Round 1 is open and everyone");
      const all = await roundTexts(t, everything.groupId, 1);
      t.check_(same(all, QUESTIONS), `All questions: ${JSON.stringify(all)}`);
      await t.panel("Round 1 of this loop", all.join("\n"));
    } },

  C6: { title: "Add questions from packs", area: AREA,
    seed: async () => seedLoop(),
    run: async (t, loop) => {
      const silly = pack("Silly hypotheticals");
      const tiny = pack("Tiny joys");
      const travel = pack("Travel");
      const everyday = pack("Everyday");
      await t.signInAs(OWNER);
      await t.open(`/g/${loop.groupId}/questions`);
      await t.say("The library is browsable by pack");
      await t.see("Question packs");
      await t.say("Open two packs and pick across them");
      await togglePack(t, "Silly hypotheticals");
      await t.clickRole("checkbox", silly[0]);
      await t.clickRole("checkbox", silly[1]);
      await togglePack(t, "Tiny joys");
      await t.clickRole("checkbox", tiny[2]);
      await t.say("Picks in a folded pack still count");
      await togglePack(t, "Silly hypotheticals");
      await t.see("3 selected");
      await t.button("Add to the pool");
      await t.see("3 questions added.");
      await t.see(silly[0]);
      t.check_(same(await poolTexts(t, loop.groupId), [LAUGH, FORWARD, silly[0], silly[1], tiny[2]]), "Picks should join the pool in order");

      await t.say("Or add a whole pack at once");
      await t.button("Add all questions in Travel");
      await t.see(`${travel.length} selected`);
      await t.button("Add to the pool");
      await t.see(`${travel.length} questions added.`);
      await t.say("Now they're ticked, fixed and labelled, with nothing left to add");
      await togglePack(t, "Travel");
      await t.see("In your pool");
      const travelState = await t.eval(`(() => {
        const group = document.querySelector('section[aria-label="Travel"]');
        const boxes = [...group.querySelectorAll('input[type="checkbox"]')];
        return { fixed: boxes.every((box) => box.checked && box.disabled), tags: group.querySelectorAll(".pool-tag").length };
      })()`);
      t.check_(travelState.fixed && travelState.tags === travel.length, `Travel state: ${JSON.stringify(travelState)}`);
      await t.dontSee("Add all questions in Travel");

      await t.say("A pack partly in the pool only picks the new ones");
      await t.button("Add all questions in Everyday");
      await t.see(`${everyday.length - 2} selected`);
      await t.button("Remove all questions in Everyday");
      await t.see("0 selected");
      await t.clickRole("checkbox", everyday[2]);
      await t.button("Add to the pool");
      await t.see("1 question added.");
      await t.see(everyday[2]);
      t.check_(same(await poolTexts(t, loop.groupId), [LAUGH, FORWARD, silly[0], silly[1], tiny[2], ...travel, everyday[2]]), "Pool should have no duplicates");
    } },

};

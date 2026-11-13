/*
 * The Questions page (docs/questions-unify-design.md, PR C): one add card for any
 * kind of item, a row's editor, Stop asking and Ask again, the count of
 * turn-takers per round, and what the page loads for owners and members.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, memberships } from "@/db/schema";
import {
  addQuestionTexts,
  askAgain,
  askThisRound,
  hasAnswers,
  itemInputFrom,
  setQuestionsPerRound,
  stopAsking,
  updateItem,
} from "../../src/lib/ask-items.ts";
import { questionsPageOf } from "../../src/lib/questions-page.ts";
import { openRound } from "../../src/lib/rounds.ts";
import { AFTER_FIRST_SLOT, DAY, rows, seedLoop, seedReplies, setupDatabase } from "../support/app.ts";
import { addItem, BLANK_ITEM } from "../support/items.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy, text as copyText } from "@/lib/copy";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const at = AFTER_FIRST_SLOT;

async function groupOf(groupId: string) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId));
  return group;
}

async function viewerOf(groupId: string, email: string) {
  const [viewer] = await db.select().from(memberships).where(eq(memberships.email, email));
  assert.equal(viewer.groupId, groupId);
  return viewer;
}

async function roundTexts(groupId: string) {
  const found = await rows<{ text: string }>(
    "select iq.text from issue_questions iq join issues i on i.id = iq.issue_id where i.group_id = $1 and i.status = 'open' order by iq.position",
    [groupId],
  );
  return found.map((row) => row.text);
}

async function item(id: string) {
  const [row] = await rows<Record<string, unknown>>("select * from questions where id = $1", [id]);
  return row;
}

async function open(groupId: string) {
  const round = await openRound({ groupId, at, prompt: false });
  assert.ok(round);
  return round;
}

test("the form's fields read as an item, and anything unknown falls back to the plain choice", () => {
  const form = new FormData();
  form.set("text", " Tea? ");
  form.set("format", "poll");
  form.set("frequency", "on_date");
  form.append("option", "Yes");
  form.append("option", "No");
  form.set("multiple", "on");
  form.set("emoji", "🍵");
  form.set("description", "Be honest");
  form.set("adminOnly", "on");
  form.set("dateKind", "birthday");
  form.set("date", "1990-01-06");
  form.set("aboutMembershipId", "someone");
  assert.deepEqual(itemInputFrom(form), {
    text: " Tea? ", format: "poll", frequency: "on_date", pollOptions: ["Yes", "No"], pollMultiple: true,
    emoji: "🍵", description: "Be honest", adminOnly: true, dateKind: "birthday", date: "1990-01-06", aboutMembershipId: "someone",
  });

  const odd = new FormData();
  odd.set("format", "essay");
  odd.set("frequency", "weekly");
  assert.deepEqual(itemInputFrom(odd), {
    text: "", format: "written", frequency: "rotating", pollOptions: [], pollMultiple: false,
    emoji: "", description: "", adminOnly: false, dateKind: "once", date: "", aboutMembershipId: null,
  });
});

test("the add card makes any kind of item, and each joins this round as its frequency says", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2"] });
  await rows("update groups set questions_per_round = 1 where id = $1", [loop.groupId]);
  await open(loop.groupId);
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1"]);

  const waits = await addItem(loop.groupId, { text: "Waits its turn", frequency: "rotating" });
  const now = await addItem(loop.groupId, { text: "Asked now too", frequency: "rotating" }, { thisRound: true });
  const wall = await addItem(loop.groupId, { text: "  Photo wall ", format: "photo_wall", emoji: " 📸 ", description: "  Your week  ", adminOnly: true });
  const party = await addItem(loop.groupId, { text: "Party", frequency: "on_date", date: "2026-01-06" }, { at });
  const later = await addItem(loop.groupId, { text: "Later party", frequency: "on_date", date: "2026-06-06" }, { at });
  assert.ok(waits.ok && now.ok && wall.ok && party.ok && later.ok);
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Asked now too", "Photo wall", "Party"]);

  assert.deepEqual(
    { text: (await item(wall.id)).text, emoji: (await item(wall.id)).emoji, description: (await item(wall.id)).description, admin_only: (await item(wall.id)).admin_only, active: (await item(wall.id)).active },
    { text: "Photo wall", emoji: "📸", description: "Your week", admin_only: true, active: false },
  );
  // Asked now, a turn-taker has had this turn: it waits at the back.
  const queue = await rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [loop.groupId]);
  assert.deepEqual(queue.map((row) => row.text), ["Q2", "Q1", "Waits its turn", "Asked now too"]);
});

test("an item is checked before it is added", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const refused = async (input: Parameters<typeof addItem>[1], code: string) => assert.deepEqual(await addItem(loop.groupId, input, { at }), { ok: false, code });

  await refused({ text: "   " }, "text");
  await refused({ text: "x".repeat(201) }, "text");
  await refused({ text: "Pick", format: "poll", pollOptions: ["One", "one"] }, "poll");
  await refused({ text: "Party", frequency: "on_date", date: "soon" }, "date");
  await refused({ text: "Party", frequency: "on_date", date: "2026-02-30" }, "date");
  await refused({ text: "Party", frequency: "on_date", date: "2025-12-31" }, "pastDate");
  await refused({ text: "", frequency: "on_date", dateKind: "birthday", date: "1990-03-01" }, "person");
  await refused({ text: "", frequency: "on_date", dateKind: "birthday", date: "1990-03-01", aboutMembershipId: other.members[0]?.id ?? alice.id.replace(/./, "0") }, "person");

  // A birthday needs no words: it is titled from the person's name.
  const birthday = await addItem(loop.groupId, { text: "ignored", format: "photo_wall", frequency: "on_date", dateKind: "birthday", date: "1990-03-01", aboutMembershipId: alice.id });
  assert.ok(birthday.ok);
  const row = await item(birthday.id);
  assert.deepEqual([row.text, row.format, row.date_kind, row.year, row.about_membership_id], ["", "photo_wall", "birthday", null, alice.id]);
  // A poll that isn't a poll keeps no options.
  const plain = await addItem(loop.groupId, { text: "Plain", pollOptions: ["a", "b"], pollMultiple: true });
  assert.ok(plain.ok);
  assert.deepEqual([(await item(plain.id)).poll_options, (await item(plain.id)).poll_multiple], [null, false]);
});

test("the editor reaches this round unless someone wrote there, and keeps a format people answered in", async () => {
  const loop = await seedLoop({ questions: ["Q1"] });
  const group = await groupOf(loop.groupId);
  const poll = await addItem(loop.groupId, { text: "Tea?", format: "poll", pollOptions: ["Tea", "Coffee"] });
  assert.ok(poll.ok);
  const round = await open(loop.groupId);

  const edit = (questionId: string, input: Partial<typeof BLANK_ITEM>) =>
    updateItem({ group, questionId, item: { ...BLANK_ITEM, ...input } as typeof BLANK_ITEM, at });

  // Nobody has answered: anything can change, and the round's copy follows.
  assert.deepEqual(await edit(poll.id, { text: "Tea or coffee?", format: "poll", pollOptions: ["Tea", "Coffee", "Water"], pollMultiple: true }), { ok: true, id: poll.id });
  const [fresh] = await rows<{ text: string; poll_options: string[]; poll_multiple: boolean }>("select text, poll_options, poll_multiple from issue_questions where question_id = $1", [poll.id]);
  assert.deepEqual({ ...fresh }, { text: "Tea or coffee?", poll_options: ["Tea", "Coffee", "Water"], poll_multiple: true });

  // Once someone picked, the format and options stay, whatever the form says; the words still change for the next round.
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [snapshot] = await rows<{ id: string }>("select id from issue_questions where question_id = $1", [poll.id]);
  await rows("insert into replies (issue_id, issue_question_id, membership_id, poll_choices, status) values ($1, $2, $3, '[0]', 'submitted')", [round.issueId, snapshot.id, alice.id]);
  assert.equal(await hasAnswers(poll.id), true);
  assert.deepEqual(await edit(poll.id, { text: "Hot drinks?", format: "photo_wall", pollOptions: [] }), { ok: true, id: poll.id });
  const kept = await item(poll.id);
  assert.deepEqual([kept.text, kept.format, kept.kind, kept.poll_options], ["Hot drinks?", "poll", "poll", ["Tea", "Coffee", "Water"]]);
  const [frozen] = await rows<{ text: string }>("select text from issue_questions where id = $1", [snapshot.id]);
  assert.equal(frozen.text, "Tea or coffee?", "the words Alice answered stay");

  // Refusals.
  assert.deepEqual(await edit(poll.id, { text: "" }), { ok: false, code: "text" });
  assert.deepEqual(await edit("00000000-0000-4000-8000-000000000000", { text: "Gone" }), { ok: false, code: "gone" });
});

test("changing how often moves an item: to every round it joins now, to turns it goes to the back, to a date it joins on its day", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3"] });
  const group = await groupOf(loop.groupId);
  await rows("update groups set questions_per_round = 1 where id = $1", [loop.groupId]);
  await open(loop.groupId);
  const [q2, q3] = (await rows<{ id: string }>("select id from questions where text in ('Q2', 'Q3') order by text")).map((row) => row.id);

  await updateItem({ group, questionId: q2, item: { ...BLANK_ITEM, text: "Q2", frequency: "every_round" }, at });
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Q2"]);
  const [moved] = await rows<{ active: boolean }>("select active from questions where id = $1", [q2]);
  assert.equal(moved.active, true, "still a question the code before the switch knows");

  await updateItem({ group, questionId: q2, item: { ...BLANK_ITEM, text: "Q2", frequency: "rotating" }, at });
  const queue = await rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [loop.groupId]);
  assert.deepEqual(queue.map((row) => row.text), ["Q3", "Q1", "Q2"]);

  await updateItem({ group, questionId: q3, item: { ...BLANK_ITEM, text: "Q3 day", format: "music", frequency: "on_date", date: "2026-01-07" }, at });
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Q2", "Q3 day"]);
  const [dated] = await rows<{ active: boolean; date_kind: string; day: number }>("select active, date_kind, day from questions where id = $1", [q3]);
  assert.deepEqual({ ...dated }, { active: false, date_kind: "once", day: 7 });
});

test("stop asking takes an unanswered item out of this round; ask again brings it back where its frequency says", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2"] });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  const wall = await addItem(loop.groupId, { text: "Wall", format: "photo_wall" });
  const party = await addItem(loop.groupId, { text: "Party", frequency: "on_date", date: "2026-01-06" }, { at });
  assert.ok(wall.ok && party.ok);
  const round = await open(loop.groupId);
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Q2", "Wall", "Party"]);
  const [q1, q2] = (await rows<{ id: string }>("select id from questions where text in ('Q1', 'Q2') order by text")).map((row) => row.id);
  await seedReplies({ issueId: round.issueId, membershipId: loop.members[1].id, answers: [{ text: "Q1", body: "Mine." }] });

  assert.equal(await stopAsking(loop.groupId, q1, at), "written");
  assert.equal(await stopAsking(loop.groupId, q2, at), "removed");
  assert.equal(await stopAsking(loop.groupId, wall.id, at), "removed");
  assert.equal(await stopAsking(loop.groupId, party.id, at), "removed");
  assert.equal(await stopAsking(loop.groupId, q2, at), null, "already stopped");
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1"]);

  assert.equal(await askAgain(loop.groupId, q2), true);
  assert.equal(await askAgain(loop.groupId, wall.id), true);
  assert.equal(await askAgain(loop.groupId, party.id), true);
  assert.equal(await askAgain(loop.groupId, wall.id), false, "already asked");
  // The wall joins now; the date was taken out of this round, so it stays out; Q2 waits at the back.
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Wall"]);
  const queue = await rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' and archived_at is null order by position", [loop.groupId]);
  assert.deepEqual(queue.map((row) => row.text), ["Q2"]);

  assert.equal(await askThisRound(loop.groupId, q2), true);
  assert.equal(await askThisRound(loop.groupId, q2), false, "already asked");
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Wall", "Q2"]);
});

test("library questions take turns like any other, skipping any the loop already asks", async () => {
  const loop = await seedLoop({ questions: ["Q1"] });
  await open(loop.groupId);
  assert.equal(await addQuestionTexts(loop.groupId, ["One?", " One? ", "Two?"], at), 2);
  assert.equal(await addQuestionTexts(loop.groupId, ["Two?"], at), 0);
  // They wait at the back of the queue; the open round is left as it was.
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1"]);
  const pool = await rows<{ text: string; frequency: string }>("select text, frequency from questions where group_id = $1 order by position", [loop.groupId]);
  assert.deepEqual(pool.map((row) => [row.text, row.frequency]), [["Q1", "rotating"], ["One?", "rotating"], ["Two?", "rotating"]]);
});

test("the count of turn-takers per round is a whole number up to 20, or all, and leaves this round alone", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3"] });
  await open(loop.groupId);
  assert.equal(await setQuestionsPerRound(loop.groupId, 1), true);
  assert.deepEqual(await roundTexts(loop.groupId), ["Q1", "Q2", "Q3"]);
  for (const bad of [0, 21, 1.5, Number.NaN]) assert.equal(await setQuestionsPerRound(loop.groupId, bad), false);
  assert.equal((await groupOf(loop.groupId)).questionsPerRound, 1);
  assert.equal(await setQuestionsPerRound(loop.groupId, null), true);
  assert.equal((await groupOf(loop.groupId)).questionsPerRound, null);
});

test("the page shows this round in its order, then the queue with each item's round, every-round items and dates", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3"] });
  const group = await groupOf(loop.groupId);
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const wall = await addItem(loop.groupId, { text: "Wall", format: "photo_wall" });
  const secret = await addItem(loop.groupId, { text: "Owners only", adminOnly: true });
  const birthday = await addItem(loop.groupId, { text: "", frequency: "on_date", dateKind: "birthday", date: "1990-01-20", aboutMembershipId: alice.id });
  const gone = await addItem(loop.groupId, { text: "Gone by", frequency: "on_date", date: "2026-01-03" }, { at: new Date("2026-01-01T12:00:00Z") });
  const stopped = await addItem(loop.groupId, { text: "Stopped", format: "music" });
  const earlier = await addItem(loop.groupId, { text: "Stopped earlier", frequency: "rotating" });
  assert.ok(wall.ok && secret.ok && birthday.ok && gone.ok && stopped.ok && earlier.ok);
  await stopAsking(loop.groupId, earlier.id, new Date(at.getTime() - DAY));
  await stopAsking(loop.groupId, stopped.id, at);

  // Before any round: Up next starts at round 1.
  const owner = await viewerOf(loop.groupId, "owner@friendloop.test");
  const before = await questionsPageOf({ group: await groupOf(loop.groupId), viewer: owner, at });
  assert.equal(before.round, null);
  assert.deepEqual(before.thisRound, []);
  assert.equal(before.plan[0].number, 1);

  const round = await open(loop.groupId);
  await seedReplies({ issueId: round.issueId, membershipId: alice.id, answers: [{ text: "Q1", body: "Hi." }] });
  await seedReplies({ issueId: round.issueId, membershipId: loop.members.find((member) => member.email.startsWith("bob"))!.id, answers: [{ text: "Q1", body: "Hello." }] });
  const later = new Date(at.getTime() + 2 * DAY);
  const page = await questionsPageOf({ group: await groupOf(loop.groupId), viewer: owner, at: later });

  assert.equal(page.round?.number, 1);
  assert.deepEqual(page.thisRound.map((row) => [row.text, row.frequency, row.writers.length]), [
    ["Q1", "rotating", 2], ["Q2", "rotating", 0], ["Wall", "every_round", 0], ["Owners only", "every_round", 0], ["Gone by", "on_date", 0],
  ]);
  assert.equal(page.thisRound[4].occurrenceLabel, "Sat, Jan 3");
  assert.deepEqual(page.queue.map((entry) => [entry.label, entry.firstRound?.number]), [["Q3", 2], ["Q1", 2], ["Q2", 3]]);
  assert.equal(page.queue[1].answered, true);
  assert.equal(page.queue[0].answered, false);
  assert.deepEqual(page.everyRound.map((entry) => entry.label), ["Wall", "Owners only"]);
  assert.deepEqual(page.dated.map((entry) => [entry.label, entry.nextLabel, entry.firstRound?.number ?? null, entry.inputDate]), [
    [copyText(copy.events.birthdayRow, { name: "Alice" }), "Tue, Jan 20", 3, "2026-01-20"],
    ["Gone by", null, null, "2026-01-03"],
  ]);
  assert.deepEqual(page.stopped.map((entry) => entry.label), ["Stopped", "Stopped earlier"], "the latest first");
  assert.deepEqual(page.plan.map((entry) => entry.number), [2, 3]);

  // A member sees what they could be asked: nothing owners-only, no calendar, nothing stopped.
  const mine = await questionsPageOf({ group, viewer: await viewerOf(loop.groupId, alice.email), at: later });
  assert.deepEqual(mine.thisRound.map((row) => row.text), ["Q1", "Q2", "Wall", "Gone by"]);
  assert.deepEqual(mine.everyRound.map((entry) => entry.label), ["Wall"]);
  assert.deepEqual([mine.dated, mine.stopped], [[], []]);
});

test("a paused loop with no round plans from now; a birthday whose person left drops off the list", async () => {
  const loop = await seedLoop({ questions: ["Q1"] });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await addItem(loop.groupId, { text: "", frequency: "on_date", dateKind: "birthday", date: "1990-01-20", aboutMembershipId: alice.id });
  await open(loop.groupId);
  await rows("update issues set status = 'delivered', delivered_at = now() where group_id = $1", [loop.groupId]);
  await rows("update memberships set revoked_at = now() where id = $1", [alice.id]);
  const owner = await viewerOf(loop.groupId, "owner@friendloop.test");
  const page = await questionsPageOf({ group: await groupOf(loop.groupId), viewer: owner, at });
  assert.equal(page.round, null);
  assert.equal(page.plan[0].number, 2, "after the last round there was");
  assert.deepEqual(page.dated, []);
});

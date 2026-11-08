/*
 * The queue and the open round (docs/questions-unify-design.md, "Rotation and Up
 * next"): opening a round takes the next turn-takers and sends them to the back,
 * every-round and dated items follow, and each edit of the open round is a direct
 * operation on it.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues } from "@/db/schema";
import {
  addPoolQuestion,
  addToOpenRound,
  fillOpenRound,
  insertPoolItem,
  newQuestionFrequency,
  refreshOpenRound,
  removeFromOpenRound,
  resizeOpenRound,
  snapshotRound,
} from "../../src/lib/round-questions.ts";
import { placeDatedItems } from "../../src/lib/events.ts";
import { openRound } from "../../src/lib/rounds.ts";
import { AFTER_FIRST_SLOT, DAY, groupOf, rows, seedLoop, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"];

async function open(groupId: string, weeks = 0) {
  await rows("update issues set status = 'delivered', delivered_at = now() where group_id = $1 and status = 'open'", [groupId]);
  const round = await openRound({ groupId, at: new Date(AFTER_FIRST_SLOT.getTime() + weeks * 7 * DAY), prompt: false });
  assert.ok(round);
  return round;
}

async function roundTexts(issueId: string) {
  const found = await rows<{ text: string }>("select text from issue_questions where issue_id = $1 order by position", [issueId]);
  return found.map((row) => row.text);
}

async function queue(groupId: string) {
  const found = await rows<{ text: string }>(
    "select text from questions where group_id = $1 and frequency = 'rotating' and archived_at is null order by position, created_at",
    [groupId],
  );
  return found.map((row) => row.text);
}

async function idOf(groupId: string, text: string) {
  const [row] = await rows<{ id: string }>("select id from questions where group_id = $1 and text = $2", [groupId, text]);
  return row.id;
}

async function answer(issueId: string, text: string, membershipId: string) {
  const [snapshot] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = $2", [issueId, text]);
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, status) values ($1, $2, $3, 'Mine', 'submitted')",
    [issueId, snapshot.id, membershipId],
  );
}

async function setCount(groupId: string, count: number | null) {
  await db.update(groups).set({ questionsPerRound: count }).where(eq(groups.id, groupId));
}

test("rounds take their turns from the head of the queue and send them to the back", async () => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await setCount(loop.groupId, 2);

  const first = await open(loop.groupId);
  assert.deepEqual(await roundTexts(first.issueId), ["Q1", "Q2"]);
  assert.deepEqual(await queue(loop.groupId), ["Q3", "Q4", "Q5", "Q1", "Q2"]);
  const second = await open(loop.groupId, 1);
  assert.deepEqual(await roundTexts(second.issueId), ["Q3", "Q4"]);
  const third = await open(loop.groupId, 2);
  assert.deepEqual(await roundTexts(third.issueId), ["Q5", "Q1"]);

  // The loop's own cursor stays at the head; the round's points where code from
  // before the switch would find the turns it just took: at the back.
  const [group] = await rows<{ question_cursor: number }>("select question_cursor from groups where id = $1", [loop.groupId]);
  assert.equal(group.question_cursor, 0);
  const [issue] = await rows<{ question_cursor: number }>("select question_cursor from issues where id = $1", [third.issueId]);
  assert.equal(issue.question_cursor, 3);
});

test("a round asks its turn-takers, then every-round items, then the dates in its days", async () => {
  const loop = await seedLoop({ questions: ["Turn one", "Turn two"] });
  await setCount(loop.groupId, 1);
  const at = AFTER_FIRST_SLOT;
  await insertPoolItem({ groupId: loop.groupId, text: "Photo wall", format: "photo_wall", frequency: "every_round", asQuestion: false, emoji: "📸", at });
  await insertPoolItem({ groupId: loop.groupId, text: "Every week", format: "written", frequency: "every_round", asQuestion: true, at });
  await insertPoolItem({
    groupId: loop.groupId, text: "Camping", format: "written", frequency: "on_date", asQuestion: false, at,
    date: { kind: "once", month: 1, day: 5, year: 2026, aboutMembershipId: null },
  });
  // A stopped item is never asked; a picture that takes turns isn't one of the questions older code knows.
  const stopped = await insertPoolItem({ groupId: loop.groupId, text: "Stopped", format: "written", frequency: "every_round", asQuestion: true, at });
  await rows("update questions set archived_at = now() where id = $1", [stopped]);
  await rows("update questions set skip_next = true where group_id = $1", [loop.groupId]);

  const round = await open(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Turn one", "Every week", "Photo wall", "Camping"]);
  const [wall] = await rows<{ format: string; emoji: string; kind: string }>(
    "select format, emoji, kind from issue_questions where issue_id = $1 and text = 'Photo wall'", [round.issueId]);
  assert.deepEqual(wall, { format: "photo_wall", emoji: "📸", kind: "written" });
  const skipped = await rows("select 1 from questions where group_id = $1 and skip_next", [loop.groupId]);
  assert.equal(skipped.length, 0, "sitting out only ever meant the round it was set in");
});

test("snapshotting outside a transaction counts what it asked and keeps a picture out of the cursor", async () => {
  const loop = await seedLoop({ questions: ["Only question"] });
  await insertPoolItem({ groupId: loop.groupId, text: "Weekly picture", format: "photo_wall", frequency: "rotating", asQuestion: false, at: AFTER_FIRST_SLOT });
  const [issue] = await db
    .insert(issues)
    .values({ groupId: loop.groupId, number: 1, slotAt: AFTER_FIRST_SLOT, opensAt: AFTER_FIRST_SLOT, deliversAt: new Date(AFTER_FIRST_SLOT.getTime() + 7 * DAY) })
    .returning();
  const count = await snapshotRound({ group: await groupOf(loop.groupId), issueId: issue.id, opensAt: issue.opensAt, deliversAt: issue.deliversAt });
  assert.equal(count, 2);
  const [after] = await rows<{ question_cursor: number }>("select question_cursor from issues where id = $1", [issue.id]);
  assert.equal(after.question_cursor, 0, "one active question, taken");
});

test("adding to the open round: a new item joins after its kind, a turn-taker goes to the back", async () => {
  const loop = await seedLoop({ questions: QUESTIONS });
  const at = AFTER_FIRST_SLOT;
  const id = await insertPoolItem({ groupId: loop.groupId, text: "Weekly", format: "written", frequency: "every_round", asQuestion: true, at });
  assert.equal(await addToOpenRound(loop.groupId, id), false, "no round open yet");

  await setCount(loop.groupId, 2);
  const round = await open(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2", "Weekly"]);
  assert.equal(await addToOpenRound(loop.groupId, id), false, "already asked");
  assert.equal(await addToOpenRound(loop.groupId, "00000000-0000-4000-8000-000000000000"), false);

  // Pulled from the queue: it joins the turn-takers, before the every-round item.
  assert.equal(await addToOpenRound(loop.groupId, await idOf(loop.groupId, "Q4")), true);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2", "Q4", "Weekly"]);
  assert.deepEqual(await queue(loop.groupId), ["Q3", "Q5", "Q1", "Q2", "Q4"]);

  // A date joins only when its day is in the round.
  const inside = await insertPoolItem({
    groupId: loop.groupId, text: "Party", format: "written", frequency: "on_date", asQuestion: false, at,
    date: { kind: "once", month: 1, day: 6, year: 2026, aboutMembershipId: null },
  });
  const outside = await insertPoolItem({
    groupId: loop.groupId, text: "Later", format: "written", frequency: "on_date", asQuestion: false, at,
    date: { kind: "once", month: 6, day: 6, year: 2026, aboutMembershipId: null },
  });
  assert.equal(await addToOpenRound(loop.groupId, inside), true);
  assert.equal(await addToOpenRound(loop.groupId, outside), false);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2", "Q4", "Weekly", "Party"]);
});

test("removing from the open round: refused once written, a turn-taker goes first in line", async () => {
  const loop = await seedLoop({ questions: QUESTIONS });
  assert.equal(await removeFromOpenRound(loop.groupId, await idOf(loop.groupId, "Q1")), "absent", "no round open");
  await setCount(loop.groupId, 2);
  const round = await open(loop.groupId);

  await answer(round.issueId, "Q1", loop.members[1].id);
  assert.equal(await removeFromOpenRound(loop.groupId, await idOf(loop.groupId, "Q1")), "written");
  assert.equal(await removeFromOpenRound(loop.groupId, await idOf(loop.groupId, "Q3")), "absent", "not in this round");

  assert.equal(await removeFromOpenRound(loop.groupId, await idOf(loop.groupId, "Q2")), "removed");
  assert.deepEqual(await roundTexts(round.issueId), ["Q1"]);
  assert.deepEqual(await queue(loop.groupId), ["Q2", "Q3", "Q4", "Q5", "Q1"]);

  // The next round asks it first.
  const next = await open(loop.groupId, 1);
  assert.deepEqual(await roundTexts(next.issueId), ["Q2", "Q3"]);
});

test("a date taken out of the round stays out when the round is carried over", async () => {
  const loop = await seedLoop({ questions: ["Q1"] });
  const party = await insertPoolItem({
    groupId: loop.groupId, text: "Party", format: "written", frequency: "on_date", asQuestion: false, at: AFTER_FIRST_SLOT,
    date: { kind: "once", month: 1, day: 6, year: 2026, aboutMembershipId: null },
  });
  const round = await open(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Party"]);
  assert.equal(await removeFromOpenRound(loop.groupId, party), "removed");
  const [row] = await rows<{ skipped: string }>("select skipped_dates::text as skipped from questions where id = $1", [party]);
  assert.equal(row.skipped, "{2026-01-06}");

  const [issue] = await rows<{ opens_at: Date; delivers_at: Date }>("select opens_at, delivers_at from issues where id = $1", [round.issueId]);
  const placed = await placeDatedItems({
    group: await groupOf(loop.groupId),
    issueId: round.issueId,
    opensAt: issue.opens_at,
    deliversAt: new Date(issue.delivers_at.getTime() + 7 * DAY),
  });
  assert.equal(placed, 0);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1"]);
});

test("an edit reaches the open round unless someone wrote there, and never a dated card", async () => {
  const loop = await seedLoop({ questions: ["Old words", "Answered"] });
  const at = AFTER_FIRST_SLOT;
  await refreshOpenRound(loop.groupId, await idOf(loop.groupId, "Old words"));
  const party = await insertPoolItem({
    groupId: loop.groupId, text: "Party", format: "written", frequency: "on_date", asQuestion: false, at,
    date: { kind: "once", month: 1, day: 6, year: 2026, aboutMembershipId: null },
  });
  const later = await insertPoolItem({ groupId: loop.groupId, text: "Not asked", format: "written", frequency: "rotating", asQuestion: true, at });
  await setCount(loop.groupId, 2);
  const round = await open(loop.groupId);
  await answer(round.issueId, "Answered", loop.members[1].id);

  await rows("update questions set text = 'New words', emoji = '✨', description = 'More', admin_only = true where id = $1", [await idOf(loop.groupId, "Old words")]);
  await rows("update questions set text = 'Changed after' where text = 'Answered'");
  await rows("update questions set text = 'Moved party' where id = $1", [party]);
  for (const id of [await idOf(loop.groupId, "New words"), await idOf(loop.groupId, "Changed after"), party, later]) {
    await refreshOpenRound(loop.groupId, id);
  }
  const found = await rows<{ text: string; emoji: string | null; description: string | null; admin_only: boolean }>(
    "select text, emoji, description, admin_only from issue_questions where issue_id = $1 order by position", [round.issueId]);
  assert.deepEqual(found.map((row) => row.text), ["New words", "Answered", "Party"]);
  assert.deepEqual(found[0], { text: "New words", emoji: "✨", description: "More", admin_only: true });
});

test("a smaller count sends unwritten turns back to the front; a larger one takes more", async () => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await resizeOpenRound(loop.groupId);
  const round = await open(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), QUESTIONS);
  await answer(round.issueId, "Q4", loop.members[1].id);

  await setCount(loop.groupId, 2);
  await resizeOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q4"]);
  assert.deepEqual(await queue(loop.groupId), ["Q2", "Q3", "Q5", "Q1", "Q4"]);

  // Already at the count: nothing to drop.
  await resizeOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q4"]);

  await setCount(loop.groupId, 3);
  await resizeOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q4", "Q2"]);

  // Every turn written in: a count of one keeps them all.
  await answer(round.issueId, "Q1", loop.members[1].id);
  await answer(round.issueId, "Q2", loop.members[1].id);
  await setCount(loop.groupId, 1);
  await resizeOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q4", "Q2"]);
});

test("filling the round leaves out what sits this round out, and stops at the count", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2"] });
  await fillOpenRound(loop.groupId);
  const round = await open(loop.groupId);
  await fillOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2"], "nothing new to take");

  const sitting = await insertPoolItem({ groupId: loop.groupId, text: "Sitting out", format: "written", frequency: "rotating", asQuestion: true, at: AFTER_FIRST_SLOT });
  await rows("update questions set skip_next = true where id = $1", [sitting]);
  await insertPoolItem({ groupId: loop.groupId, text: "Weekly", format: "music", frequency: "every_round", asQuestion: false, at: AFTER_FIRST_SLOT });
  await fillOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2", "Weekly"]);

  await setCount(loop.groupId, 2);
  await rows("update questions set skip_next = false where id = $1", [sitting]);
  await fillOpenRound(loop.groupId);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "Q2", "Weekly"], "already asks its two turns");
});

test("a snapshot whose item was deleted keeps its place at the end when the round renumbers", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Gone"] });
  const round = await open(loop.groupId);
  await rows("delete from questions where text = 'Gone'");
  await rows("update issue_questions set position = 0 where issue_id = $1 and question_id is null", [round.issueId]);
  await rows("update issue_questions set position = 1 where issue_id = $1 and question_id is not null", [round.issueId]);
  const id = await insertPoolItem({ groupId: loop.groupId, text: "New", format: "written", frequency: "rotating", asQuestion: true, at: AFTER_FIRST_SLOT });
  assert.equal(await addToOpenRound(loop.groupId, id), true);
  assert.deepEqual(await roundTexts(round.issueId), ["Q1", "New", "Gone"]);
});

test("a new item goes to the back of its own group; sections count from 1000", async () => {
  const loop = await seedLoop({ questions: ["Q1", "Q2"] });
  const at = AFTER_FIRST_SLOT;
  const position = async (id: string) => (await rows<{ position: number; active: boolean }>("select position, active from questions where id = $1", [id]))[0];

  assert.deepEqual(await position(await insertPoolItem({ groupId: loop.groupId, text: "Turn", format: "poll", frequency: "rotating", asQuestion: true, pollOptions: ["a", "b"], at })), { position: 2, active: true });
  assert.deepEqual(await position(await insertPoolItem({ groupId: loop.groupId, text: "Weekly question", format: "written", frequency: "every_round", asQuestion: true, at })), { position: 0, active: true });
  assert.deepEqual(await position(await insertPoolItem({ groupId: loop.groupId, text: "Weekly question 2", format: "written", frequency: "every_round", asQuestion: true, at })), { position: 1, active: true });
  assert.deepEqual(await position(await insertPoolItem({ groupId: loop.groupId, text: "Section", format: "written", frequency: "every_round", asQuestion: false, at })), { position: 1000, active: false });
  assert.deepEqual(await position(await insertPoolItem({ groupId: loop.groupId, text: "Section 2", format: "photo_wall", frequency: "every_round", asQuestion: false, at })), { position: 1001, active: false });
  assert.deepEqual(await position(await insertPoolItem({
    groupId: loop.groupId, text: "", format: "written", frequency: "on_date", asQuestion: false, at,
    date: { kind: "birthday", month: 3, day: 1, year: null, aboutMembershipId: loop.members[1].id },
  })), { position: 0, active: false });
  const [poll] = await rows<{ kind: string; poll_options: string[] }>("select kind, poll_options from questions where text = 'Turn'");
  assert.deepEqual(poll, { kind: "poll", poll_options: ["a", "b"] });
});

test("a new question takes turns, unless the loop asks every question every round", async () => {
  const loop = await seedLoop({ questions: [] });
  assert.equal(await newQuestionFrequency(loop.groupId), "every_round", "an all-questions loop with nothing taking turns");
  const first = await addPoolQuestion({ groupId: loop.groupId, text: "First", at: AFTER_FIRST_SLOT });
  const [row] = await rows<{ frequency: string }>("select frequency from questions where id = $1", [first]);
  assert.equal(row.frequency, "every_round");

  await insertPoolItem({ groupId: loop.groupId, text: "Turn", format: "written", frequency: "rotating", asQuestion: true, at: AFTER_FIRST_SLOT });
  assert.equal(await newQuestionFrequency(loop.groupId), "rotating", "the loop still has turn-takers");
  await setCount(loop.groupId, 3);
  await rows("update questions set archived_at = now() where text = 'Turn'");
  assert.equal(await newQuestionFrequency(loop.groupId), "rotating", "a count means turns");

  // In an all-questions loop with a round open, it joins that round at once.
  await setCount(loop.groupId, null);
  const round = await open(loop.groupId);
  await addPoolQuestion({ groupId: loop.groupId, text: "Late", format: "poll", pollOptions: ["x", "y"], at: AFTER_FIRST_SLOT });
  assert.deepEqual(await roundTexts(round.issueId), ["First", "Late"]);
});

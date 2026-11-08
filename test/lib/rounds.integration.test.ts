import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createLoop } from "../../src/lib/manage.ts";
import { stopAsking, updateItem } from "../../src/lib/ask-items.ts";
import { removeFromOpenRound, reorderPool } from "../../src/lib/round-questions.ts";
import { addItem, BLANK_ITEM } from "../support/items.ts";
import { openRound, sendRoundNow } from "../../src/lib/rounds.ts";
import { resolveToken } from "../../src/lib/reply.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { latestOutbox, outboxCount, rows, seedLoop, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const LAUGH = "What made you laugh this week?";

type RoundRow = { id: string; number: number; status: string; opens_at: Date; delivers_at: Date; delivered_at: Date | null };

async function roundsOf(groupId: string): Promise<RoundRow[]> {
  return rows<RoundRow>(
    "select id, number, status, opens_at, delivers_at, delivered_at from issues where group_id = $1 order by number",
    [groupId],
  );
}

async function askedIn(issueId: string): Promise<string[]> {
  const asked = await rows<{ text: string }>("select text from issue_questions where issue_id = $1 order by position", [issueId]);
  return asked.map((row) => row.text);
}

async function openLoop(questions?: string[]) {
  const loop = await seedLoop(questions ? { questions } : {});
  await sweep({ at: AFTER_FIRST_SLOT });
  const [round] = await roundsOf(loop.groupId);
  return { loop, round };
}

test("creating a loop opens round 1 at once, due at the first delivery, and emails the owner", async () => {
  const [user] = await rows<{ id: string }>("insert into users (email, name) values ('owner@friendloop.test', 'Owner') returning id");
  const groupId = await createLoop({
    ownerUserId: user.id,
    ownerEmail: "owner@friendloop.test",
    name: "Friday Loop",
    timezone: "Europe/Amsterdam",
    promptWeekday: 5,
    promptHour: 9,
    cadenceWeeks: 1,
    questions: ["First?", "Second?"],
    at: E2E_NOW,
  });

  const [round] = await roundsOf(groupId);
  assert.equal(round.number, 1);
  assert.equal(round.status, "open");
  assert.equal(new Date(round.opens_at).toISOString(), E2E_NOW.toISOString());
  assert.equal(new Date(round.delivers_at).toISOString(), "2026-01-09T08:00:00.000Z");
  assert.deepEqual(await askedIn(round.id), ["First?", "Second?"]);
  assert.equal(await outboxCount("prompt:"), 1, "the owner is the only one in it yet");
});

test("a loop created an hour before its delivery still goes out then", async () => {
  const [user] = await rows<{ id: string }>("insert into users (email) values ('owner@friendloop.test') returning id");
  const at = new Date("2026-01-02T07:00:00Z"); // Friday 08:00 Amsterdam
  const groupId = await createLoop({
    ownerUserId: user.id,
    ownerEmail: "owner@friendloop.test",
    name: "Last minute",
    timezone: "Europe/Amsterdam",
    promptWeekday: 5,
    promptHour: 9,
    cadenceWeeks: 1,
    questions: ["Quick one?"],
    at,
  });
  const [round] = await roundsOf(groupId);
  assert.equal(new Date(round.delivers_at).toISOString(), "2026-01-02T08:00:00.000Z");
});

test("send now with nothing open, or nothing in it, sends nothing", async () => {
  const loop = await seedLoop();
  assert.deepEqual(await sendRoundNow(loop.groupId, AFTER_FIRST_SLOT), { state: "none" });

  await sweep({ at: AFTER_FIRST_SLOT });
  assert.deepEqual(await sendRoundNow(loop.groupId, AFTER_FIRST_SLOT), { state: "empty", number: 1 });
  assert.equal(await outboxCount("delivery:"), 0);
  const [round] = await roundsOf(loop.groupId);
  assert.equal(round.status, "open");
});

test("send now sends the round as it stands and opens the next, due a delivery later", async () => {
  const { loop, round } = await openLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: LAUGH, body: "The cat." }] });

  const at = new Date("2026-01-07T12:00:00Z"); // Wednesday, two days before it was due
  const result = await sendRoundNow(loop.groupId, at);
  assert.equal(result.state, "sent");

  const [sent, next] = await roundsOf(loop.groupId);
  assert.equal(sent.status, "delivered");
  assert.equal(new Date(sent.delivered_at!).toISOString(), at.toISOString());
  assert.equal(next.status, "open");
  assert.equal(new Date(next.opens_at).toISOString(), at.toISOString());
  // This round took the place of Friday's delivery, so the next one is the Friday after.
  assert.equal(new Date(next.delivers_at).toISOString(), "2026-01-16T08:00:00.000Z");
  assert.equal(await outboxCount("delivery:"), 3);

  const email = await latestOutbox("delivery:");
  assert.match(email.html, /The cat\./);
  assert.match(email.html, /Next up: Round 2/);

  // The Friday it would have gone out passes quietly.
  const report = await sweep({ at: new Date("2026-01-09T08:05:00Z") });
  assert.equal(report.delivered + report.carried + report.opened, 0);
});

test("opening a round twice returns the open one", async () => {
  const loop = await seedLoop();
  const first = await openRound({ groupId: loop.groupId, at: AFTER_FIRST_SLOT, prompt: true });
  const again = await openRound({ groupId: loop.groupId, at: new Date(AFTER_FIRST_SLOT.getTime() + 60_000), prompt: true });
  assert.ok(first?.created);
  assert.deepEqual(again, { ...first, created: false });
  assert.equal(await outboxCount("prompt:"), 3);
  assert.equal(await openRound({ groupId: "00000000-0000-4000-8000-000000000000", at: E2E_NOW, prompt: false }), null);
});

test("an item added, edited or stopped while a round is open changes that round; reordering changes the queue", async () => {
  const { loop, round } = await openLoop(["One?", "Two?"]);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);

  // A turn-taker waits its turn unless it's asked for now too; an every-round item joins at once.
  const waiting = await addItem(loop.groupId, { text: "Waits?", frequency: "rotating" }, { at: E2E_NOW });
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);
  const three = await addItem(loop.groupId, { text: "Three?", frequency: "rotating" }, { thisRound: true, at: E2E_NOW });
  const potluck = await addItem(loop.groupId, { text: "Potluck" }, { at: E2E_NOW });
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?", "Three?", "Potluck"]);
  assert.ok(waiting.ok && three.ok && potluck.ok);

  // The list is the queue: the round people are answering keeps its order.
  await reorderPool(loop.groupId, "rotating", three.id, 0);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?", "Three?", "Potluck"]);
  const queue = await rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [loop.groupId]);
  assert.deepEqual(queue.map((row) => row.text), ["Three?", "One?", "Two?", "Waits?"]);

  const [group] = await rows<{ id: string; timezone: string }>("select id, timezone from groups where id = $1", [loop.groupId]);
  await updateItem({ group, questionId: potluck.id, item: { ...BLANK_ITEM, text: "Potluck corner", emoji: "🥧" }, at: E2E_NOW });
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?", "Three?", "Potluck corner"]);

  await stopAsking(loop.groupId, three.id, E2E_NOW);
  await stopAsking(loop.groupId, potluck.id, E2E_NOW);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);
});

test("an item someone has started answering stays in the round when it is stopped", async () => {
  const { loop, round } = await openLoop(["One?", "Two?"]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "One?", body: "Already written." }] });

  assert.equal(await stopAsking(loop.groupId, loop.questionIds[0], E2E_NOW), "written");
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"], "kept for its answer, in its place");
});

test("a paused loop takes no answers: its reply link opens on nothing", async () => {
  const { loop } = await openLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  const live = await resolveToken(alice.token);
  assert.equal(live.state === "ok" && live.issue?.number, 1);

  await rows("update groups set paused_at = $1 where id = $2", [BEFORE_FIRST_SLOT.toISOString(), loop.groupId]);
  const paused = await resolveToken(alice.token);
  assert.equal(paused.state, "ok");
  assert.equal(paused.state === "ok" && paused.issue, null);
});

test("a turn-taker taken out of this round goes first in line, and the round takes nothing in its place", async () => {
  const loop = await seedLoop({ questions: ["One?", "Two?", "Three?", "Four?"] });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await sweep({ at: AFTER_FIRST_SLOT });
  const [round] = await roundsOf(loop.groupId);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);

  assert.equal(await removeFromOpenRound(loop.groupId, loop.questionIds[1]), "removed");
  assert.deepEqual(await askedIn(round.id), ["One?"]);
  const queue = await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId]);
  assert.deepEqual(queue.map((row) => row.text), ["Two?", "Three?", "Four?", "One?"], "first in line for the next round");

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "One?", body: "Yes." }] });
  await sweep({ at: new Date(round.delivers_at) });
  const [, next] = await roundsOf(loop.groupId);
  assert.deepEqual(await askedIn(next.id), ["Two?", "Three?"]);
});

test("an owner's nudge goes to everyone still owing an answer except the owner", async () => {
  const { loop } = await openLoop();
  const { nudgeStragglers } = await import("../../src/lib/notify.ts");
  const owner = loop.members.find((member) => member.access === "owner")!;
  assert.equal(await nudgeStragglers(loop.groupId, owner.id), 2);
  const sent = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  assert.deepEqual(sent.map((row) => row.to), ["alice@friendloop.test", "bob@friendloop.test"]);
});

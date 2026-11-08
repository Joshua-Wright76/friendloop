import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addQuestion,
  archiveQuestion,
  createLoop,
  reorderQuestion,
  toggleSkipNext,
} from "../../src/lib/manage.ts";
import { openRound, sendRoundNow } from "../../src/lib/rounds.ts";
import { archiveSection, createSection, updateSection } from "../../src/lib/sections.ts";
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
    mode: "group",
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
    mode: "group",
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
  assert.match(email.html, /Next up: Issue 2/);

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

test("a question added, ordered or archived while a round is open changes that round", async () => {
  const { loop, round } = await openLoop(["One?", "Two?"]);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);

  const threeId = await addQuestion(loop.groupId, "Three?", E2E_NOW);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?", "Three?"]);

  await reorderQuestion(loop.groupId, threeId!, 0);
  assert.deepEqual(await askedIn(round.id), ["Three?", "One?", "Two?"]);

  await archiveQuestion(loop.groupId, threeId!, E2E_NOW);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);
});

test("a question someone has started answering stays in the round when it leaves the pool", async () => {
  const { loop, round } = await openLoop(["One?", "Two?"]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "One?", body: "Already written." }] });

  await archiveQuestion(loop.groupId, loop.questionIds[0], E2E_NOW);
  assert.deepEqual(await askedIn(round.id), ["Two?", "One?"], "kept for its answer, after the rest");
});

test("skipping a question takes it out of the open round until that round goes out", async () => {
  const { loop, round } = await openLoop(["One?", "Two?"]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await toggleSkipNext(loop.groupId, loop.questionIds[1]);
  assert.deepEqual(await askedIn(round.id), ["One?"]);

  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "One?", body: "Yes." }] });
  await sweep({ at: new Date(round.delivers_at) });

  const [, next] = await roundsOf(loop.groupId);
  assert.deepEqual(await askedIn(next.id), ["One?", "Two?"], "the skip covered only the round that went out");
  const [question] = await rows<{ skip_next: boolean }>("select skip_next from questions where id = $1", [loop.questionIds[1]]);
  assert.equal(question.skip_next, false);
});

test("a section added, edited or archived while a round is open changes that round", async () => {
  const { loop, round } = await openLoop();
  const sectionsIn = async () =>
    (await rows<{ title: string }>("select title from issue_sections where issue_id = $1 order by position", [round.id])).map((row) => row.title);

  await createSection({ groupId: loop.groupId, kind: "standard", title: "Potluck", emoji: null, description: null, adminOnly: false, at: E2E_NOW });
  assert.deepEqual(await sectionsIn(), ["Potluck"]);

  const [section] = await rows<{ id: string }>("select id from sections where group_id = $1", [loop.groupId]);
  await updateSection({ groupId: loop.groupId, sectionId: section.id, title: "Potluck corner", emoji: "🥧", description: null, adminOnly: false, active: true });
  assert.deepEqual(await sectionsIn(), ["Potluck corner"]);

  await archiveSection({ groupId: loop.groupId, sectionId: section.id, at: E2E_NOW });
  assert.deepEqual(await sectionsIn(), []);
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

test("a section someone has written in stays in the round when it is archived", async () => {
  const { loop, round } = await openLoop();
  await createSection({ groupId: loop.groupId, kind: "standard", title: "Potluck", emoji: null, description: null, adminOnly: false, at: E2E_NOW });
  const [section] = await rows<{ id: string }>("select id from sections where group_id = $1", [loop.groupId]);
  const [snapshot] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1", [round.id]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows(
    "insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'Lasagna.', 'draft')",
    [round.id, snapshot.id, alice.id],
  );

  await archiveSection({ groupId: loop.groupId, sectionId: section.id, at: E2E_NOW });
  const kept = await rows<{ title: string }>("select title from issue_sections where issue_id = $1", [round.id]);
  assert.deepEqual(kept.map((row) => row.title), ["Potluck"]);
});

test("with a rotating pool, the open round re-picks from where it started", async () => {
  const loop = await seedLoop({ questions: ["One?", "Two?", "Three?", "Four?"] });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await sweep({ at: AFTER_FIRST_SLOT });
  const [round] = await roundsOf(loop.groupId);
  assert.deepEqual(await askedIn(round.id), ["One?", "Two?"]);

  await toggleSkipNext(loop.groupId, loop.questionIds[1]);
  assert.deepEqual(await askedIn(round.id), ["One?", "Three?"]);
  const [group] = await rows<{ question_cursor: number }>("select question_cursor from groups where id = $1", [loop.groupId]);
  assert.equal(group.question_cursor, 3, "the next round starts after the last one this round now asks");
});

test("an owner's nudge goes to everyone still owing an answer except the owner", async () => {
  const { loop } = await openLoop();
  const { nudgeStragglers } = await import("../../src/lib/notify.ts");
  const owner = loop.members.find((member) => member.access === "owner")!;
  assert.equal(await nudgeStragglers(loop.groupId, owner.id), 2);
  const sent = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  assert.deepEqual(sent.map((row) => row.to), ["alice@friendloop.test", "bob@friendloop.test"]);
});

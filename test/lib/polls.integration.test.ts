import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { addPoll, archiveQuestion, reorderQuestion } from "../../src/lib/manage.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import {
  saveAudioFor,
  saveDraftFor,
  savePhotoFor,
  savePollChoicesFor,
  sheetFor,
  submitFor,
} from "../../src/lib/reply.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { copy } from "../../src/lib/copy.ts";
import { latestOutbox, outboxCount, resetDatabase, rows, seedLoop, setupDatabase } from "../support/app.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const CAMP = ["The lake", "The mountains", "The coast"];
const AFTER_DELIVERY = new Date(DELIVERY_DAY.getTime() + 60_000);

/** A loop with one written question and one poll, opened by the real sweep. */
async function openPollLoop(input: { multiple?: boolean; shared?: boolean } = {}) {
  const loop = await seedLoop({ questions: ["What made you laugh this week?"] });
  await seedPoll(loop, { text: "Where should we camp?", options: CAMP, multiple: input.multiple ?? false });
  if (input.shared) await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  await sweep({ at: AFTER_FIRST_SLOT });

  const [written] = await rows<{ id: string }>("select id from issue_questions where kind = 'written'");
  const [poll] = await rows<{ id: string }>("select id from issue_questions where kind = 'poll'");
  const [issue] = await rows<{ id: string }>("select id from issues limit 1");
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  return { loop, written: written.id, poll: poll.id, issueId: issue.id, alice, bob };
}

async function vote(token: string, issueQuestionId: string, choices: unknown) {
  return savePollChoicesFor({ token, issueQuestionId, choices });
}

test("addPoll puts a poll at the end of the pool and refuses a malformed one", async () => {
  const loop = await seedLoop();
  const added = await addPoll(loop.groupId, { prompt: " Camp where? ", options: ["Lake", " Coast ", "lake"], multiple: true }, E2E_NOW);
  assert.equal(added.ok, true);

  const [row] = await rows<{ text: string; kind: string; poll_multiple: boolean; poll_options: string[]; position: number }>(
    "select text, kind, poll_multiple, poll_options, position from questions where kind = 'poll'",
  );
  assert.equal(row.text, "Camp where?");
  assert.deepEqual(row.poll_options, ["Lake", "Coast"]);
  assert.equal(row.poll_multiple, true);
  assert.equal(row.position, 2);

  const refused = await addPoll(loop.groupId, { prompt: "Camp where?", options: ["Only one"], multiple: false }, E2E_NOW);
  assert.deepEqual(refused, { ok: false, error: copy.polls.errors.optionCount });
  const [{ count }] = await rows<{ count: string }>("select count(*) as count from questions where kind = 'poll'");
  assert.equal(Number(count), 1);
});

test("a poll reorders and archives like any question", async () => {
  const loop = await seedLoop({ questions: ["One", "Two"] });
  const pollId = await seedPoll(loop, { text: "Pick", options: ["a", "b"] });

  assert.equal(await reorderQuestion(loop.groupId, pollId, 0), true);
  const ordered = await rows<{ text: string }>("select text from questions order by position");
  assert.deepEqual(ordered.map((row) => row.text), ["Pick", "One", "Two"]);

  await archiveQuestion(loop.groupId, pollId, E2E_NOW);
  const [archived] = await rows<{ active: boolean; archived_at: string | null }>(
    "select active, archived_at from questions where id = $1",
    [pollId],
  );
  assert.equal(archived.active, false);
  assert.ok(archived.archived_at);
});

test("a poll rotates through the pool with the written questions", async () => {
  const loop = await seedLoop({ questions: ["One"] });
  await seedPoll(loop, { text: "Pick", options: ["a", "b"] });
  await rows("update groups set questions_per_round = 1 where id = $1", [loop.groupId]);

  await sweep({ at: AFTER_FIRST_SLOT });
  const first = await rows<{ text: string; kind: string }>("select text, kind from issue_questions");
  assert.deepEqual(first.map((row) => [row.text, row.kind]), [["One", "written"]]);

  // The next slot (a week on) carries the poll.
  const nextWeek = new Date(AFTER_FIRST_SLOT.getTime() + 8 * 24 * 60 * 60 * 1000);
  await sweep({ at: nextWeek });
  // Nobody answered round 1, so that sweep skipped it and paused the loop.
  await rows("update groups set paused_at = null");
  await sweep({ at: nextWeek });
  const second = await rows<{ text: string; kind: string }>(
    "select iq.text, iq.kind from issue_questions iq join issues i on i.id = iq.issue_id where i.number = 2",
  );
  assert.deepEqual(second.map((row) => [row.text, row.kind]), [["Pick", "poll"]]);
});

test("the issue snapshot freezes a poll's options and mode", async () => {
  const { loop, poll } = await openPollLoop({ multiple: true });
  await rows("update questions set poll_options = $1::jsonb, poll_multiple = false where group_id = $2 and kind = 'poll'", [
    JSON.stringify(["Changed", "Edited"]),
    loop.groupId,
  ]);

  const [snapshot] = await rows<{ poll_options: string[]; poll_multiple: boolean }>(
    "select poll_options, poll_multiple from issue_questions where id = $1",
    [poll],
  );
  assert.deepEqual(snapshot.poll_options, CAMP);
  assert.equal(snapshot.poll_multiple, true);
});

test("the reply sheet carries the poll's options and this person's own pick, nothing else", async () => {
  const { alice, bob, poll } = await openPollLoop();
  await vote(alice.token, poll, [1]);
  await vote(bob.token, poll, [0]);

  const sheet = await sheetFor(alice.token);
  const pollQuestion = sheet!.questions.find((question) => question.id === poll)!;
  assert.equal(pollQuestion.kind, "poll");
  assert.deepEqual(pollQuestion.pollOptions, CAMP);
  assert.deepEqual(pollQuestion.pollChoices, [1]);
  assert.equal(pollQuestion.pollMultiple, false);

  const written = sheet!.questions.find((question) => question.kind === "written")!;
  assert.deepEqual(written.pollOptions, []);
  assert.deepEqual(written.pollChoices, []);
});

test("a single-choice pick can be changed and cleared until delivery", async () => {
  const { alice, poll } = await openPollLoop();

  assert.equal((await vote(alice.token, poll, [0])).ok, true);
  assert.equal((await vote(alice.token, poll, [2])).ok, true);
  const [changed] = await rows<{ poll_choices: number[] }>("select poll_choices from replies where issue_question_id = $1", [poll]);
  assert.deepEqual(changed.poll_choices, [2]);

  assert.equal((await vote(alice.token, poll, [])).ok, true);
  const [cleared] = await rows<{ poll_choices: number[]; body: string }>("select poll_choices, body from replies where issue_question_id = $1", [poll]);
  assert.deepEqual(cleared.poll_choices, []);
  assert.equal(cleared.body, "");
});

test("a multi-choice poll keeps every option picked, in order", async () => {
  const { alice, poll } = await openPollLoop({ multiple: true });
  assert.equal((await vote(alice.token, poll, [2, 0])).ok, true);
  const [row] = await rows<{ poll_choices: number[] }>("select poll_choices from replies where issue_question_id = $1", [poll]);
  assert.deepEqual(row.poll_choices, [0, 2]);
});

test("picks outside the poll, or two picks on a single-choice poll, are refused with a 400", async () => {
  const { alice, poll } = await openPollLoop();

  for (const bad of [[0, 1], [3], [-1], ["0"], [0, 0], "0", null]) {
    const result = await vote(alice.token, poll, bad);
    assert.deepEqual(result, { ok: false, status: 400, error: copy.polls.errors.choices });
  }
  assert.equal((await rows("select 1 from replies where issue_question_id = $1", [poll])).length, 0);
});

test("a poll and a written question each refuse the other's writes", async () => {
  const { alice, poll, written } = await openPollLoop();

  const pickOnWritten = await vote(alice.token, written, [0]);
  assert.equal(pickOnWritten.ok, false);
  assert.equal(!pickOnWritten.ok && pickOnWritten.status, 409);

  const textOnPoll = await saveDraftFor({ token: alice.token, issueQuestionId: poll, body: "the lake!" });
  assert.equal(textOnPoll.ok, false);
  assert.equal(!textOnPoll.ok && textOnPoll.status, 409);

  const photoOnPoll = await savePhotoFor({ token: alice.token, issueQuestionId: poll, photoUrl: "/uploads/x.png" });
  assert.equal(photoOnPoll.ok, false);
  const audioOnPoll = await saveAudioFor({ token: alice.token, issueQuestionId: poll, audioUrl: "/uploads/x.webm", audioDurationMs: 1000 });
  assert.equal(audioOnPoll.ok, false);
  assert.equal((await rows("select 1 from replies")).length, 0);
});

test("readers and unknown links cannot vote", async () => {
  const { loop, alice, poll } = await openPollLoop();
  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  const reader = await vote(alice.token, poll, [0]);
  assert.equal(!reader.ok && reader.status, 403);
  const stranger = await vote("never-issued", poll, [0]);
  assert.equal(!stranger.ok && stranger.status, 404);
  assert.equal(loop.members.length > 0, true);
});

test("a pick alone is enough to send; an unsent or cleared pick is not an answer", async () => {
  const { alice, bob, poll } = await openPollLoop();

  await vote(alice.token, poll, [1]);
  await vote(bob.token, poll, [0]);
  await vote(bob.token, poll, []);
  assert.equal((await submitFor(alice.token)).ok, true);
  assert.equal((await submitFor(bob.token)).ok, true);

  const submitted = await rows<{ membership_id: string }>("select membership_id from replies where status = 'submitted'");
  assert.deepEqual(submitted.map((row) => row.membership_id), [alice.id]);
});

test("before delivery nobody sees a tally or anyone else's pick, only their own", async () => {
  const { loop, alice, bob, poll, issueId } = await openPollLoop({ multiple: true });
  await vote(alice.token, poll, [0, 1]);
  await vote(bob.token, poll, [0]);
  await submitFor(alice.token);
  await submitFor(bob.token);

  const asAlice = await loadIssue({ issueId, viewerMembershipId: alice.id });
  const block = asAlice!.blocks.find((candidate) => candidate.poll)!;
  assert.equal(block.poll!.tally, null);
  assert.equal(block.poll!.voters, null);
  assert.deepEqual(block.answers.map((answer) => answer.choices), [["The lake", "The mountains"]]);
  assert.equal(asAlice!.answerCount, 1);

  const stranger = await loadIssue({ issueId });
  const strangerBlock = stranger!.blocks.find((candidate) => candidate.poll)!;
  assert.equal(strangerBlock.poll!.tally, null);
  assert.deepEqual(strangerBlock.answers, []);
  assert.equal(loop.members.length > 0, true);
});

test("once delivered, every pick shows by name beside a tally, including to share-link visitors", async () => {
  const { alice, bob, poll, issueId } = await openPollLoop({ multiple: true, shared: true });
  await vote(alice.token, poll, [0, 1]);
  await vote(bob.token, poll, [0]);
  await submitFor(alice.token);
  await submitFor(bob.token);

  const report = await sweep({ at: AFTER_DELIVERY });
  assert.equal(report.delivered, 1);

  const view = await loadIssue({ issueId, viewerMembershipId: alice.id });
  const block = view!.blocks.find((candidate) => candidate.poll)!;
  assert.deepEqual(block.poll, {
    multiple: true,
    tally: [
      { option: "The lake", votes: 2 },
      { option: "The mountains", votes: 1 },
      { option: "The coast", votes: 0 },
    ],
    voters: 2,
  });
  const byAuthor = Object.fromEntries(block.answers.map((answer) => [answer.author, answer.choices]));
  assert.deepEqual(byAuthor, { You: ["The lake", "The mountains"], Bob: ["The lake"] });

  const [{ share_token: shareToken }] = await rows<{ share_token: string }>("select share_token from issues where number = 1");
  const shared = await loadIssue({ shareToken });
  const sharedBlock = shared!.blocks.find((candidate) => candidate.poll)!;
  assert.equal(sharedBlock.poll!.voters, 2);
  assert.deepEqual(
    sharedBlock.answers.map((answer) => answer.author).sort(),
    ["Alice", "Bob"],
  );
});

test("a pick cleared after sending drops out of the issue and the count", async () => {
  const { alice, bob, poll, issueId } = await openPollLoop();
  await vote(alice.token, poll, [1]);
  await vote(bob.token, poll, [1]);
  await submitFor(alice.token);
  await submitFor(bob.token);
  await vote(bob.token, poll, []);

  await sweep({ at: AFTER_DELIVERY });
  const view = await loadIssue({ issueId });
  const block = view!.blocks.find((candidate) => candidate.poll)!;
  assert.equal(block.poll!.voters, 1);
  assert.deepEqual(block.answers.map((answer) => answer.author), ["Alice"]);
});

test("a vote after delivery is marked late and moves the tally", async () => {
  const { alice, bob, poll, issueId } = await openPollLoop();
  await vote(alice.token, poll, [0]);
  await submitFor(alice.token);
  // Paused, so delivery doesn't open the next round and the sheet still points here.
  await rows("update groups set paused_at = $1", [AFTER_FIRST_SLOT.toISOString()]);
  await sweep({ at: AFTER_DELIVERY });

  setRequestHeaders({ "x-e2e-now": new Date(AFTER_DELIVERY.getTime() + 3_600_000).toISOString() });
  assert.equal((await vote(bob.token, poll, [2])).ok, true);
  assert.equal((await submitFor(bob.token)).ok, true);

  const view = await loadIssue({ issueId });
  const block = view!.blocks.find((candidate) => candidate.poll)!;
  assert.equal(block.poll!.voters, 2);
  assert.equal(block.poll!.tally![2].votes, 1);
  const late = block.answers.find((answer) => answer.author === "Bob")!;
  assert.equal(late.addedLater, true);
  assert.equal(block.answers.find((answer) => answer.author === "Alice")!.addedLater, false);
});

test("a round with only a poll pick still delivers, and the email shows the pick and the results", async () => {
  const { alice, bob, poll } = await openPollLoop();
  await vote(alice.token, poll, [2]);
  await vote(bob.token, poll, [2]);
  await submitFor(alice.token);
  await submitFor(bob.token);
  await vote(bob.token, poll, []);

  const report = await sweep({ at: AFTER_DELIVERY });
  assert.equal(report.delivered, 1);
  assert.equal(report.skipped, 0);

  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("Where should we camp?"));
  assert.ok(email.html.includes("Chose: The coast"));
  assert.ok(email.html.includes("Results: The lake: 0 · The mountains: 0 · The coast: 1"));
  assert.ok(email.text.includes("Alice: Chose: The coast"));
  // Bob cleared his pick, so he is not in the issue at all.
  assert.ok(!email.html.includes(">Bob<"));
});

test("a round whose only content is a cleared poll pick is skipped", async () => {
  const { alice, poll } = await openPollLoop();
  await vote(alice.token, poll, [1]);
  await submitFor(alice.token);
  await vote(alice.token, poll, []);

  const report = await sweep({ at: AFTER_DELIVERY });
  assert.equal(report.skipped, 1);
  assert.equal(await outboxCount("delivery:"), 0);
});

test("the prompt counts a poll as a question", async () => {
  await openPollLoop();
  const prompt = await latestOutbox("prompt:");
  assert.ok(prompt.subject.includes("2 questions"));
});

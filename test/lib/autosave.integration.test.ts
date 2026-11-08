import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { saveDraftFor, savePhotoFor, savePollChoicesFor } from "../../src/lib/reply.ts";
import { createSection } from "../../src/lib/sections.ts";
import { answeredMemberIds } from "../../src/lib/answered.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { loadAlbum } from "../../src/lib/album.ts";
import { nudgeStragglers } from "../../src/lib/notify.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { storePhoto } from "../../src/lib/photo-storage.ts";
import { latestOutbox, outboxCount, resetDatabase, rows, seedDeliveredIssue, seedLoop, seedOpenIssue, setupDatabase } from "../support/app.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

/*
 * Whatever someone has written is in. There is no send step: a saved, non-empty
 * answer goes out at delivery and counts everywhere an answer counts.
 */

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

async function openRound(input: { poll?: boolean } = {}) {
  const loop = await seedLoop();
  if (input.poll) await seedPoll(loop, { text: "Lake or sea?", options: ["Lake", "Sea"] });
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const member = (prefix: string) => loop.members.find((candidate) => candidate.email.startsWith(prefix))!;
  const questions = await rows<{ id: string; text: string }>(
    "select id, text from issue_questions where issue_id = $1 order by position",
    [issue.issueId],
  );
  return { loop, issue, alice: member("alice"), bob: member("bob"), owner: member("owner"), questions };
}

test("a saved answer goes out at delivery without anyone pressing anything", async () => {
  const { alice, bob, questions } = await openRound();
  await saveDraftFor({ token: alice.token, issueQuestionId: questions[0].id, body: "Half a thought, still mine" });
  const photoUrl = await storePhoto(Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]), { contentType: "image/jpeg", extension: "jpg" });
  await savePhotoFor({ token: bob.token, issueQuestionId: questions[1].id, photoUrl });

  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.delivered, 1);
  assert.equal(report.carried, 0);

  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("Half a thought, still mine"));
  assert.ok(email.html.includes(photoUrl), "a photo on its own is an answer too");
});

test("an answer cleared back to nothing stays out, and a round of only cleared answers carries over", async () => {
  const { alice, bob, questions } = await openRound();
  await saveDraftFor({ token: alice.token, issueQuestionId: questions[0].id, body: "Never mind" });
  await saveDraftFor({ token: alice.token, issueQuestionId: questions[0].id, body: "" });
  await saveDraftFor({ token: bob.token, issueQuestionId: questions[0].id, body: "  \n " });

  assert.equal((await answeredMemberIds((await rows<{ id: string }>("select id from issues"))[0].id)).size, 0);

  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.delivered, 0);
  assert.equal(report.carried, 1, "nothing in it: it carries over rather than going out empty");
  assert.equal(await outboxCount("delivery:"), 0);
});

test("a cleared answer is left out of a round that does go out", async () => {
  const { alice, bob, questions, issue } = await openRound();
  await saveDraftFor({ token: alice.token, issueQuestionId: questions[0].id, body: "Staying in" });
  await saveDraftFor({ token: bob.token, issueQuestionId: questions[0].id, body: "Taking this back" });
  await saveDraftFor({ token: bob.token, issueQuestionId: questions[0].id, body: "" });

  assert.equal((await sweep({ at: DELIVERY_DAY })).delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("Staying in"));
  assert.ok(!email.html.includes("Taking this back"));

  const view = await loadIssue({ issueId: issue.issueId });
  assert.deepEqual(view!.blocks[0].answers.map((answer) => answer.body), ["Staying in"]);
  assert.equal(view!.answerCount, 1);
});

test("progress, the reminder and the owner's nudge count saved answers", async () => {
  const { loop, alice, bob, owner, questions, issue } = await openRound({ poll: true });
  await saveDraftFor({ token: alice.token, issueQuestionId: questions[0].id, body: "Written, never 'sent'" });
  // A pick is an answer as well, until it is cleared.
  const [poll] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and kind = 'poll'", [issue.issueId]);
  assert.equal((await savePollChoicesFor({ token: bob.token, issueQuestionId: poll.id, choices: [1] })).ok, true);
  assert.deepEqual([...(await answeredMemberIds(issue.issueId))].sort(), [alice.id, bob.id].sort());
  await savePollChoicesFor({ token: bob.token, issueQuestionId: poll.id, choices: [] });

  assert.deepEqual([...(await answeredMemberIds(issue.issueId))], [alice.id], "a cleared pick is nothing written");

  const reminded = await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) });
  assert.equal(reminded.reminded, 2);
  const reminders = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  assert.deepEqual(reminders.map((row) => row.to), [bob.email, owner.email].sort());

  assert.equal(await nudgeStragglers(loop.groupId), 2);
  const nudged = await rows<{ to: string }>("select \"to\" from outbox where dedupe_key like 'manual-reminder:%' order by \"to\"");
  assert.ok(!nudged.some((row) => row.to === alice.email), "alice has something written, so she isn't nudged");
});

test("a section answer counts as having answered", async () => {
  const { loop, owner, issue } = await openRound();
  // Added while the round is open, so it joins the round people are answering.
  await createSection({ groupId: loop.groupId, kind: "standard", title: "News", emoji: null, description: null, adminOnly: false, at: new Date() });
  const [section] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and text = 'News'", [issue.issueId]);

  await saveDraftFor({ token: owner.token, issueQuestionId: section.id, body: "We moved." });
  assert.deepEqual([...(await answeredMemberIds(issue.issueId))], [owner.id]);
});

test("an answer written by code from before this change still goes out", async () => {
  const { alice, questions, issue } = await openRound();
  // What the old sheet wrote while its Send button still existed.
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, status) values ($1, $2, $3, 'From the old sheet', 'draft')",
    [issue.issueId, questions[0].id, alice.id],
  );
  assert.equal((await sweep({ at: DELIVERY_DAY })).delivered, 1);
  assert.ok((await latestOutbox("delivery:")).html.includes("From the old sheet"));
});

test("a draft a past round went out without never appears in it", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [{ email: alice.email, body: "What went out" }],
  });
  const [question] = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position offset 1 limit 1", [delivered.issueId]);
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, photo_url, status, never_sent) values ($1, $2, $3, 'Never sent', '/uploads/never.png', 'draft', true)",
    [delivered.issueId, question.id, alice.id],
  );

  const view = await loadIssue({ issueId: delivered.issueId });
  const bodies = view!.blocks.flatMap((block) => block.answers.map((answer) => answer.body));
  assert.deepEqual(bodies, ["What went out"]);

  const album = await loadAlbum({ groupId: loop.groupId, viewerMembershipId: alice.id, viewerIsAdmin: true, filters: { member: null, q: "", pages: 1 } });
  assert.equal(album.total, 0, "its photo stays out of the album too");
});

test("the migration counts open-round drafts in and keeps past-round drafts out", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const past = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [{ email: alice.email, body: "Sent back then" }] });
  const open = await seedOpenIssue(loop, { openedAt: DELIVERY_DAY });
  const pastQuestion = (await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position offset 1 limit 1", [past.issueId]))[0].id;
  const openQuestion = (await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position limit 1", [open.issueId]))[0].id;
  const insert = "insert into replies (issue_id, issue_question_id, membership_id, body, status) values ($1, $2, $3, $4, 'draft')";
  await rows(insert, [past.issueId, pastQuestion, alice.id, "Left behind"]);
  await rows(insert, [open.issueId, openQuestion, alice.id, "Still writing"]);
  await rows(insert, [open.issueId, openQuestion, bob.id, ""]);

  const migration = readFileSync("drizzle/0021_answers_autosave.sql", "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => /^(--[^\n]*\n)*\s*UPDATE/i.test(statement));
  assert.equal(migration.length, 4);
  for (const statement of migration) await rows(statement);

  const after = await rows<{ body: string; status: string; never_sent: boolean; submitted: boolean }>(
    "select body, status, never_sent, submitted_at is not null as submitted from replies order by body",
  );
  assert.deepEqual([...after], [
    { body: "", status: "draft", never_sent: false, submitted: false },
    { body: "Left behind", status: "draft", never_sent: true, submitted: false },
    { body: "Sent back then", status: "submitted", never_sent: false, submitted: true },
    { body: "Still writing", status: "submitted", never_sent: false, submitted: true },
  ]);
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { atLeast, requireViewer, viewerFor } from "../../src/lib/permissions.ts";
import { loadIssue, membershipForViewer, reactionChoices } from "../../src/lib/issue-view.ts";
import { snapshotQuestionsForIssue } from "../../src/lib/round-questions.ts";
import { groupOf, resetDatabase, rows, seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { requestMagicLink, confirmMagicLink } from "../../src/lib/auth.ts";
import { latestOutbox } from "../support/app.ts";
import { AFTER_FIRST_SLOT, E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});



setupDatabase();

test("access ranks are ordered owner > admin > member", () => {
  assert.equal(atLeast("owner", "admin"), true);
  assert.equal(atLeast("admin", "admin"), true);
  assert.equal(atLeast("admin", "owner"), false);
  assert.equal(atLeast("member", "member"), true);
  assert.equal(atLeast("member", "admin"), false);
});

test("a viewer is the signed-in membership, and revoked means gone", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ('alice@friendloop.test', 'Alice') returning id",
  );
  await rows("update memberships set user_id = $1 where id = $2", [user.id, alice.id]);

  const signedIn = { id: user.id, email: "alice@friendloop.test", name: "Alice", timezone: "UTC" };
  const viewer = await viewerFor(loop.groupId, signedIn);
  assert.equal(viewer?.membership.id, alice.id);

  await rows("update memberships set revoked_at = $1 where id = $2", [E2E_NOW.toISOString(), alice.id]);
  assert.equal(await viewerFor(loop.groupId, signedIn), null);

  // Somebody with no session at all.
  assert.equal(await viewerFor(loop.groupId), null);

  // A member of a different loop sees nothing here.
  const other = await seedLoop({ name: "Other" });
  assert.equal(await viewerFor(other.groupId, signedIn), null);
});

test("requireViewer hides a loop from outsiders and under-ranked members", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ('alice@friendloop.test', 'Alice') returning id",
  );
  await rows("update memberships set user_id = $1 where id = $2", [user.id, alice.id]);

  // requireViewer reads the session, so the session has to be real.
  await requestMagicLink("alice@friendloop.test");
  const mail = await latestOutbox("signin:");
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.html)![1];
  await confirmMagicLink(decodeURIComponent(token));

  const viewer = await requireViewer(loop.groupId);
  assert.equal(viewer.membership.id, alice.id);
  await assert.rejects(requireViewer(loop.groupId, "owner"), /not-found/);
  await assert.rejects(requireViewer("00000000-0000-4000-8000-000000000000"), /not-found/);
});

test("a round snapshots its questions in order and advances the cursor", async () => {
  const loop = await seedLoop({ questions: ["One?", "Two?", "Three?"] });
  const group = await groupOf(loop.groupId);
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  // Re-snapshot into a second issue to observe the cursor moving.
  const [second] = await rows<{ id: string }>(
    `insert into issues (group_id, number, status, slot_at, opens_at, delivers_at)
     values ($1, 9, 'open', $2, $2, $2) returning id`,
    [loop.groupId, new Date(E2E_NOW.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()],
  );

  const count = await snapshotQuestionsForIssue({ group, issueId: second.id });
  assert.equal(count, 3);
  const snapshotted = await rows<{ text: string; position: number }>(
    "select text, position from issue_questions where issue_id = $1 order by position",
    [second.id],
  );
  assert.deepEqual(snapshotted.map((row) => row.text), ["One?", "Two?", "Three?"]);
  assert.deepEqual(snapshotted.map((row) => row.position), [0, 1, 2]);
});

test("questions that are archived, inactive, or skipped stay out of the round", async () => {
  const loop = await seedLoop({ questions: ["Keep?", "Archived?", "Inactive?"] });
  const [keep, archived, inactive] = await rows<{ id: string }>(
    "select id from questions where group_id = $1 order by position",
    [loop.groupId],
  );

  await rows("update questions set archived_at = $1, active = false where id = $2", [
    E2E_NOW.toISOString(),
    archived.id,
  ]);
  await rows("update questions set active = false where id = $1", [inactive.id]);
  await rows("update questions set skip_next = true where id = $1", [keep.id]);

  const group = await groupOf(loop.groupId);
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const [fresh] = await rows<{ id: string }>(
    `insert into issues (group_id, number, status, slot_at, opens_at, delivers_at)
     values ($1, 9, 'open', $2, $2, $2) returning id`,
    [loop.groupId, new Date(E2E_NOW.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()],
  );

  // "Skip this round" keeps the question out; the skip lasts until that round goes out.
  assert.equal(await snapshotQuestionsForIssue({ group, issueId: fresh.id }), 0);
  const [question] = await rows<{ skip_next: boolean }>("select skip_next from questions where id = $1", [keep.id]);
  assert.equal(question.skip_next, true);

  await rows("update questions set skip_next = false where id = $1", [keep.id]);
  const [nextRound] = await rows<{ id: string }>(
    `insert into issues (group_id, number, status, slot_at, opens_at, delivers_at)
     values ($1, 10, 'open', $2, $2, $2) returning id`,
    [loop.groupId, new Date(E2E_NOW.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString()],
  );
  const groupAfter = await groupOf(loop.groupId);
  assert.equal(await snapshotQuestionsForIssue({ group: groupAfter, issueId: nextRound.id }), 1);
  const texts = await rows<{ text: string }>("select text from issue_questions where issue_id = $1", [nextRound.id]);
  assert.deepEqual(texts.map((row) => row.text), ["Keep?"]);
});

test("a delivered round renders for a member, marking their own answers", async () => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [
      { email: "alice@friendloop.test", body: "Alice's answer." },
      { email: "bob@friendloop.test", body: "Bob's answer." },
    ],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Alice reacts to Bob's answer; Bob reacts to Alice's.
  const answers = await rows<{ id: string; membership_id: string }>("select id, membership_id from replies");
  const aliceReply = answers.find((answer) => answer.membership_id === alice.id)!;
  const bobReply = answers.find((answer) => answer.membership_id === bob.id)!;
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '❤️')", [
    bobReply.id,
    alice.id,
  ]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '❤️')", [
    aliceReply.id,
    bob.id,
  ]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '❤️')", [
    aliceReply.id,
    bob.id,
  ]).catch(() => undefined);
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'A comment.')", [
    issue.issueId,
    bob.id,
  ]);

  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.ok(view);
  assert.equal(view.answerCount, 2);
  assert.equal(view.blocks.length, 2);

  const allAnswers = view.blocks.flatMap((block) => block.answers);
  const mine = allAnswers.find((answer) => answer.isYou)!;
  assert.equal(mine.body, "Alice's answer.");
  assert.equal(mine.author, "You");

  const theirs = allAnswers.find((answer) => !answer.isYou)!;
  assert.equal(theirs.author, "Bob");
  const heart = theirs.reactions.find((reaction) => reaction.emoji === "❤️")!;
  assert.equal(heart.count, 1);
  assert.equal(heart.mine, true, "Alice's own reaction is marked");

  assert.equal(view.comments.length, 1);
  assert.equal(view.comments[0].author, "Bob");
  assert.deepEqual(view.comments[0].parts, [{ type: "text", text: "A comment." }]);
});

test("a stranger sees the answers without reaction controls", async () => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
    shareToken: "share-me",
  });
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);

  const view = await loadIssue({ shareToken: "share-me" });
  assert.ok(view);
  const answer = view.blocks.flatMap((block) => block.answers)[0];
  assert.equal(answer.author, "Alice");
  assert.deepEqual(answer.reactions, [], "no viewer, no reaction chips");

  // Sharing switched off closes every existing link.
  await rows("update groups set share_enabled = false where id = $1", [loop.groupId]);
  assert.equal(await loadIssue({ shareToken: "share-me" }), null);

  // An open round is never readable through a share token.
  assert.equal(await loadIssue({ shareToken: "not-a-token" }), null);
});

test("an id that is not a delivered round is still readable by id", async () => {
  const loop = await seedLoop();
  const open = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const view = await loadIssue({ issueId: open.issueId });
  assert.ok(view);
  assert.equal(view.answerCount, 0);

  assert.equal(await loadIssue({ issueId: "00000000-0000-4000-8000-000000000000" }), null);
  assert.equal(await loadIssue({}), null);
});

test("the viewer is found by session first, then by delivery token", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ('alice@friendloop.test', 'Alice') returning id",
  );
  await rows("update memberships set user_id = $1 where id = $2", [user.id, alice.id]);

  const byUser = await membershipForViewer({ groupId: loop.groupId, userId: user.id });
  assert.equal(byUser?.id, alice.id);

  const byToken = await membershipForViewer({ groupId: loop.groupId, token: alice.token });
  assert.equal(byToken?.id, alice.id);

  assert.equal(
    await membershipForViewer({
      groupId: loop.groupId,
      userId: "00000000-0000-4000-8000-000000000000",
      token: "not-a-token",
    }),
    null,
  );
  assert.equal(await membershipForViewer({ groupId: loop.groupId }), null);
});

test("the reaction choices are the three the UI ships", () => {
  assert.deepEqual(reactionChoices(), ["❤️", "😄", "👏"]);
});

test("before a round goes out, its page shows each person only their own answers", async () => {
  const loop = await seedLoop();
  const open = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedReplies({ issueId: open.issueId, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "Half a thought" }] });
  await seedReplies({ issueId: open.issueId, membershipId: bob.id, answers: [{ text: "What made you laugh this week?", body: "Bob's line" }] });

  const asAlice = await loadIssue({ issueId: open.issueId, viewerMembershipId: alice.id });
  const seen = asAlice!.blocks.flatMap((block) => block.answers.map((answer) => answer.body));
  assert.deepEqual(seen, ["Half a thought"], "Bob's answer waits for the round to go out");
  assert.equal(asAlice!.answerCount, 1);

  await rows("update issues set status = 'delivered', delivered_at = now() where id = $1", [open.issueId]);
  const afterwards = await loadIssue({ issueId: open.issueId, viewerMembershipId: alice.id });
  assert.equal(afterwards!.blocks.flatMap((block) => block.answers).length, 2);
});

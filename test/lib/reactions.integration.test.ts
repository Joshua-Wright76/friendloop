import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { MAX_REACTIONS_PER_PERSON } from "../../src/lib/reaction-emoji.ts";
import { toggleReactionFor } from "../../src/lib/reactions.ts";
import { E2E_NOW, resetDatabase, rows, seedDeliveredIssue, seedLoop, setupDatabase } from "../support/app.ts";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
});

async function aRound() {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "A very patient goose." }],
  });
  const [{ id: replyId }] = await rows<{ id: string }>("select id from replies where issue_id = $1", [issue.issueId]);
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  return { loop, issue, replyId, bob };
}

test("any emoji can be added without anyone's say-so, shows for everyone, and comes off again", async () => {
  const { issue, replyId, bob } = await aRound();
  const input = { issueId: issue.issueId, replyId, membershipId: bob.id, emoji: "🦄" };

  assert.deepEqual(await toggleReactionFor(input), { ok: true });
  let view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  const chips = view!.blocks.flatMap((block) => block.answers)[0].reactions;
  assert.deepEqual(chips.at(-1), { emoji: "🦄", count: 1, mine: true });
  assert.deepEqual(chips.slice(0, 3).map((chip) => chip.emoji), ["❤️", "😄", "👏"]);

  assert.deepEqual(await toggleReactionFor(input), { ok: true });
  view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  assert.deepEqual(view!.blocks.flatMap((block) => block.answers)[0].reactions.map((chip) => chip.emoji), ["❤️", "😄", "👏"]);
});

test("what isn't exactly one emoji is refused and stores nothing", async () => {
  const { issue, replyId, bob } = await aRound();
  for (const emoji of ["hello", "🦄🦄", "<img src=x>", ""]) {
    assert.deepEqual(await toggleReactionFor({ issueId: issue.issueId, replyId, membershipId: bob.id, emoji }), { ok: false, reason: "emoji" });
  }
  assert.equal((await rows("select id from reactions")).length, 0);
});

test("an answer from another round can't be reached through this one", async () => {
  const { issue, bob } = await aRound();
  const other = await seedLoop({ name: "Another loop" });
  const elsewhere = await seedDeliveredIssue(other, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Somewhere else entirely." }],
  });
  const [{ id: foreignReply }] = await rows<{ id: string }>("select id from replies where issue_id = $1", [elsewhere.issueId]);

  assert.deepEqual(
    await toggleReactionFor({ issueId: issue.issueId, replyId: foreignReply, membershipId: bob.id, emoji: "🦄" }),
    { ok: false, reason: "answer" },
  );
  assert.equal((await rows("select id from reactions")).length, 0);
});

test("one person's reactions on one answer have a ceiling, and taking one back makes room", async () => {
  const { issue, replyId, bob } = await aRound();
  const emoji = ["😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃", "😉", "😊"];
  assert.equal(emoji.length, MAX_REACTIONS_PER_PERSON);
  const toggle = (value: string) => toggleReactionFor({ issueId: issue.issueId, replyId, membershipId: bob.id, emoji: value });

  for (const value of emoji) assert.deepEqual(await toggle(value), { ok: true });
  assert.deepEqual(await toggle("🦄"), { ok: false, reason: "limit" });

  assert.deepEqual(await toggle("😀"), { ok: true });
  assert.deepEqual(await toggle("🦄"), { ok: true });
});

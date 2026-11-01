import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { nudgeStragglers, sendPromptEmails } from "../../src/lib/notify.ts";
import { groupOf, resetDatabase, rows, seedLoop, seedOpenIssue, seedReplies } from "../support/app.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const QUESTION = "What made you laugh this week?";


test("prompts go to contributors who have not been removed", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const group = await groupOf(loop.groupId);
  await rows("update memberships set participation = 'reader' where email = 'alice@friendloop.test'");
  await rows("update memberships set revoked_at = $1 where email = 'bob@friendloop.test'", [
    AFTER_FIRST_SLOT.toISOString(),
  ]);

  const sent = await sendPromptEmails({
    group,
    issueId: issue.issueId,
    issueNumber: issue.number,
    deliversAt: AFTER_FIRST_SLOT,
    questionCount: 2,
  });

  assert.equal(sent, 1);
  const mail = await rows<{ to: string; html: string }>("select \"to\", html from outbox where kind = 'prompt'");
  assert.deepEqual(mail.map((row) => row.to), ["owner@friendloop.test"]);
  // The email name is the loop's display name, and the link is the person's own.
  assert.match(mail[0].html, /From|Saturday|Friday Loop/i);
});

test("a round with no questions emails nobody", async () => {
  const loop = await seedLoop({ questions: [] });
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const group = await groupOf(loop.groupId);
  assert.equal(
    await sendPromptEmails({
      group,
      issueId: issue.issueId,
      issueNumber: 1,
      deliversAt: AFTER_FIRST_SLOT,
      questionCount: 0,
    }),
    0,
  );
});

test("prompting twice sends once", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const group = await groupOf(loop.groupId);
  const input = {
    group,
    issueId: issue.issueId,
    issueNumber: 1,
    deliversAt: AFTER_FIRST_SLOT,
    questionCount: 2,
  };

  assert.equal(await sendPromptEmails(input), 3);
  assert.equal(await sendPromptEmails(input), 0);
});

test("a manual nudge skips people who already answered, and numbers each repeat", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: QUESTION, body: "Answered." }],
    submittedAt: AFTER_FIRST_SLOT,
  });

  assert.equal(await nudgeStragglers(loop.groupId), 2, "owner and bob");
  const first = await rows<{ dedupe_key: string }>(
    "select dedupe_key from outbox where kind = 'reminder' order by dedupe_key",
  );
  assert.deepEqual(
    first.map((row) => row.dedupe_key),
    first.map((row) => row.dedupe_key).sort(),
  );
  assert.ok(first.every((row) => /:1$/.test(row.dedupe_key)));

  assert.equal(await nudgeStragglers(loop.groupId), 2, "a second click is a second nudge");
  const second = await rows<{ dedupe_key: string }>(
    "select dedupe_key from outbox where kind = 'reminder' and dedupe_key like '%:2'",
  );
  assert.equal(second.length, 2);
});

test("a nudge is refused when there is nothing to nudge", async () => {
  assert.equal(await nudgeStragglers("00000000-0000-4000-8000-000000000000"), 0);

  const noRound = await seedLoop();
  assert.equal(await nudgeStragglers(noRound.groupId), 0, "no open round");

  const empty = await seedLoop({ name: "Empty", questions: [] });
  await seedOpenIssue(empty, { openedAt: AFTER_FIRST_SLOT });
  assert.equal(await nudgeStragglers(empty.groupId), 0, "no questions");
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { nudgeStragglers, sendPromptEmails } from "../../src/lib/notify.ts";
import { openRound } from "../../src/lib/rounds.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { groupOf, rows, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, HOUR } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy, text as copyText } from "@/lib/copy";

setupDatabase();

beforeEach(async () => {
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

/** A loop with no questions at all: only a section everyone answers and one only admins do. */
async function sectionsOnlyLoop(sections: Array<{ title: string; adminOnly: boolean }>) {
  const loop = await seedLoop({ name: "Sections", questions: [] });
  for (const [position, section] of sections.entries()) {
    await rows(
      "insert into sections (group_id, kind, title, emoji, admin_only, position) values ($1, 'standard', $2, '📝', $3, $4)",
      [loop.groupId, section.title, section.adminOnly, position],
    );
  }
  return loop;
}

test("a round that holds only sections still sends its prompt, counting what each person can answer", async () => {
  const loop = await sectionsOnlyLoop([{ title: "This week", adminOnly: false }, { title: "Planning", adminOnly: true }]);
  const round = await openRound({ groupId: loop.groupId, at: AFTER_FIRST_SLOT, prompt: true });
  assert.ok(round?.created);

  const mail = await rows<{ to: string; subject: string; text: string }>(
    "select \"to\", subject, text from outbox where kind = 'prompt' order by \"to\"",
  );
  assert.deepEqual(mail.map((row) => [row.to, row.subject]), [
    ["alice@friendloop.test", copyText(copy.emails.prompt.subject, { memberName: "Alice", questionCount: 1, plural: copy.emails.questionSingular, groupName: "Sections" })],
    ["bob@friendloop.test", copyText(copy.emails.prompt.subject, { memberName: "Bob", questionCount: 1, plural: copy.emails.questionSingular, groupName: "Sections" })],
    ["owner@friendloop.test", copyText(copy.emails.prompt.subject, { memberName: "Sam", questionCount: 2, plural: copy.emails.questionPlural, groupName: "Sections" })],
  ]);
  assert.match(mail[2].text, /- 📝 This week\n- 📝 Planning/);
  assert.doesNotMatch(mail[0].text, /Planning/, "a member is never told about a section only admins answer");
});

test("a round whose only section is for admins prompts, reminds and nudges only them", async () => {
  const loop = await sectionsOnlyLoop([{ title: "Planning", adminOnly: true }]);
  const round = await openRound({ groupId: loop.groupId, at: AFTER_FIRST_SLOT, prompt: true });
  assert.ok(round);
  assert.deepEqual(
    (await rows<{ to: string }>("select \"to\" from outbox where kind = 'prompt'")).map((row) => row.to),
    ["owner@friendloop.test"],
  );

  assert.equal(await nudgeStragglers(loop.groupId), 1, "the owner, the one person it asks");
  const report = await sweep({ at: new Date(round.deliversAt.getTime() - 24 * HOUR) });
  assert.equal(report.reminded, 1);
  const reminders = await rows<{ to: string; text: string }>("select \"to\", text from outbox where kind = 'reminder' order by created_at");
  assert.deepEqual(reminders.map((row) => row.to), ["owner@friendloop.test", "owner@friendloop.test"]);
});

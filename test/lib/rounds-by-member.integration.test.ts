import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { deliveredRoundsAnsweredBy, parseMemberFilter } from "../../src/lib/rounds-by-member.ts";
import { resetDatabase, rows, seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, E2E_NOW } from "../../e2e/support/clock.ts";

beforeEach(async () => {
  await resetDatabase();
});

setupDatabase();

const ID = "11111111-1111-4111-8111-111111111111";

test("the member filter in the address is a membership id or nothing", () => {
  assert.equal(parseMemberFilter(undefined), null);
  assert.equal(parseMemberFilter(""), null);
  assert.equal(parseMemberFilter("alice"), null);
  assert.equal(parseMemberFilter(ID.toUpperCase()), ID);
  assert.equal(parseMemberFilter([ID, "x"]), ID);
  assert.equal(parseMemberFilter(["nope"]), null);
});

test("a person's rounds are the delivered ones they answered in", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const both = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-09T09:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "Alice in one." },
      { email: "bob@friendloop.test", body: "Bob in one." },
    ],
  });
  const onlyBob = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-16T09:00:00Z"),
    answers: [{ email: "bob@friendloop.test", body: "Bob in two." }],
  });
  const open = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await seedReplies({
    issueId: open.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Not yet delivered." }],
  });

  const aliceRounds = await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: alice.id, includeAdminOnly: false });
  assert.deepEqual([...aliceRounds], [both.issueId], "the open round is not listed");

  const bobRounds = await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: bob.id, includeAdminOnly: false });
  assert.deepEqual([...bobRounds].sort(), [both.issueId, onlyBob.issueId].sort());
});

test("someone with no delivered rounds, or a loop with none, is an empty list", async () => {
  const empty = await seedLoop({ name: "Quiet" });
  const alice = empty.members.find((member) => member.email.startsWith("alice"))!;
  assert.equal(
    (await deliveredRoundsAnsweredBy({ groupId: empty.groupId, membershipId: alice.id, includeAdminOnly: true })).size,
    0,
  );

  const other = await seedLoop({ name: "Other", owner: { email: "other-owner@friendloop.test" } });
  await seedDeliveredIssue(other, {
    deliveredAt: new Date("2026-01-09T09:00:00Z"),
    answers: [{ email: "other-owner@friendloop.test", body: "Hi." }],
  });
  assert.equal(
    (await deliveredRoundsAnsweredBy({ groupId: other.groupId, membershipId: alice.id, includeAdminOnly: true })).size,
    0,
    "a membership from another loop matches nothing here",
  );
});

test("a cleared poll pick is not an answer", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const round = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-09T09:00:00Z"),
    answers: [{ email: "bob@friendloop.test", body: "Bob." }],
  });
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 order by position limit 1",
    [round.issueId],
  );
  await rows("update issue_questions set kind = 'poll', poll_options = '[\"a\",\"b\"]'::jsonb where id = $1", [question.id]);
  await rows(
    `insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at, poll_choices)
     values ($1, $2, $3, '', 'submitted', $4, '[]'::jsonb)`,
    [round.issueId, question.id, alice.id, E2E_NOW.toISOString()],
  );
  assert.equal(
    (await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: alice.id, includeAdminOnly: true })).size,
    0,
  );
  await rows("update replies set poll_choices = '[1]'::jsonb where membership_id = $1", [alice.id]);
  assert.equal(
    (await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: alice.id, includeAdminOnly: true })).size,
    1,
  );
});

test("an answer in an admin-only section is only counted for people who may read it", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const round = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-01-09T09:00:00Z"),
    answers: [{ email: "bob@friendloop.test", body: "Bob." }],
  });
  const [section] = await rows<{ id: string }>(
    `insert into issue_sections (issue_id, kind, title, admin_only) values ($1, 'standard', 'Owners only', true) returning id`,
    [round.issueId],
  );
  await rows(
    `insert into section_replies (issue_id, issue_section_id, membership_id, body, status, submitted_at)
     values ($1, $2, $3, 'secret', 'submitted', $4)`,
    [round.issueId, section.id, alice.id, E2E_NOW.toISOString()],
  );

  const asMember = await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: alice.id, includeAdminOnly: false });
  assert.equal(asMember.size, 0);
  const asAdmin = await deliveredRoundsAnsweredBy({ groupId: loop.groupId, membershipId: alice.id, includeAdminOnly: true });
  assert.deepEqual([...asAdmin], [round.issueId]);
});

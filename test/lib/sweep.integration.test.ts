import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pendingWork, sweep } from "../../src/lib/sweep.ts";
import { outboxCount, resetDatabase, rows, seedLoop, seedOpenIssue, seedReplies } from "../support/app.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DELIVERY_DAY, E2E_NOW, HOUR } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const ALICE_QUESTION = "What made you laugh this week?";

test("a paused loop opens nothing", async () => {
  const loop = await seedLoop();
  await rows("update groups set paused_at = $1 where id = $2", [BEFORE_FIRST_SLOT.toISOString(), loop.groupId]);

  const report = await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal(report.opened, 0);
  assert.equal(await outboxCount("prompt:"), 0);
});

test("a loop with no questions opens a round and sends nothing", async () => {
  const loop = await seedLoop({ questions: [] });
  const report = await sweep({ at: AFTER_FIRST_SLOT });

  assert.equal(report.opened, 1);
  assert.equal(await outboxCount("prompt:"), 0);

  const [issue] = await rows<{ number: number; status: string }>("select number, status from issues where group_id = $1", [
    loop.groupId,
  ]);
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "open");
});

test("a second sweep for the same slot records the slot and opens nothing", async () => {
  const loop = await seedLoop();
  await sweep({ at: AFTER_FIRST_SLOT });

  // Simulate a trigger that lost the race: the slot row already exists but the
  // loop still looks un-slotted.
  await rows("update groups set last_slot_at = null where id = $1", [loop.groupId]);
  const second = await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal(second.opened, 0);

  const [group] = await rows<{ last_slot_at: Date | null }>("select last_slot_at from groups where id = $1", [
    loop.groupId,
  ]);
  assert.equal(new Date(group.last_slot_at!).toISOString(), AFTER_FIRST_SLOT.toISOString().replace("08:05", "08:00"));
});

test("an outage collapses to one round, not a backlog", async () => {
  const loop = await seedLoop();
  const weeksLater = new Date("2026-02-20T09:00:00Z");
  const report = await sweep({ at: weeksLater });

  assert.equal(report.opened, 1);
  const issues = await rows<{ count: number }>("select count(*)::int as count from issues where group_id = $1", [
    loop.groupId,
  ]);
  assert.equal(issues[0].count, 1);
});

test("delivery sends one issue email per member with their own link", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: ALICE_QUESTION, body: "The cat." }],
    submittedAt: AFTER_FIRST_SLOT,
  });
  await seedReplies({
    issueId: issue.issueId,
    membershipId: bob.id,
    answers: [{ text: ALICE_QUESTION, body: "The dog." }],
    submittedAt: AFTER_FIRST_SLOT,
  });
  await rows("update replies set added_after_delivery = true where body = 'The dog.'");

  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.delivered, 1);
  assert.equal(report.skipped, 0);

  const mail = await rows<{ to: string; html: string; subject: string }>(
    "select \"to\", html, subject from outbox where kind = 'delivery' order by \"to\"",
  );
  assert.equal(mail.length, 3);
  for (const row of mail) {
    const member = loop.members.find((candidate) => candidate.email === row.to)!;
    assert.ok(row.html.includes(`?m=${encodeURIComponent(member.token)}`), `${row.to} gets their own link`);
    assert.ok(row.html.includes("The cat.") && row.html.includes("The dog."));
  }
  // The answer added after delivery is labelled as such in the email.
  assert.match(mail[0].html, /added|late|later/i);
});

test("delivery is idempotent: a second sweep sends nothing more", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: ALICE_QUESTION, body: "Only answer." }],
    submittedAt: AFTER_FIRST_SLOT,
  });

  assert.equal((await sweep({ at: DELIVERY_DAY })).delivered, 1);
  assert.equal((await sweep({ at: DELIVERY_DAY })).delivered, 0);
  assert.equal(await outboxCount("delivery:"), 3);
});

test("a shared round gets a share token only when sharing is on", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: ALICE_QUESTION, body: "Something." }],
    submittedAt: AFTER_FIRST_SLOT,
  });
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);

  await sweep({ at: DELIVERY_DAY });

  const [row] = await rows<{ share_token: string | null }>("select share_token from issues where id = $1", [issue.issueId]);
  assert.ok(row.share_token);
  const mail = await rows<{ html: string }>("select html from outbox where kind = 'delivery' limit 1");
  assert.ok(mail[0].html.includes(`/s/${row.share_token}`));
});

test("an empty round is skipped and pauses the loop with one note to the owner", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.skipped, 1);
  assert.equal(report.delivered, 0);
  assert.equal(await outboxCount("delivery:"), 0);

  const [row] = await rows<{ status: string; skipped_at: Date | null }>(
    "select status, skipped_at from issues where id = $1",
    [issue.issueId],
  );
  assert.equal(row.status, "skipped");
  assert.ok(row.skipped_at);

  const [group] = await rows<{ paused_at: Date | null }>("select paused_at from groups where id = $1", [loop.groupId]);
  assert.ok(group.paused_at);

  const notes = await rows<{ to: string; kind: string }>("select \"to\", kind from outbox where kind = 'nudge'");
  assert.equal(notes.length, 1, "only the owner is told");
  assert.equal(notes[0].to, "owner@friendloop.test");
});

test("skipping is idempotent and never re-pauses", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  await sweep({ at: DELIVERY_DAY });
  const second = await sweep({ at: DELIVERY_DAY });
  assert.equal(second.skipped, 0);
  assert.equal(await outboxCount("skipped:"), 1);
});

test("the reminder window is 48 hours, and only reaches people who owe an answer", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: ALICE_QUESTION, body: "Done." }],
    submittedAt: AFTER_FIRST_SLOT,
  });

  // Outside the window: nothing yet.
  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() - 72 * HOUR) })).reminded, 0);

  const reminded = (await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) })).reminded;
  assert.equal(reminded, 2, "owner and bob; alice already answered");

  const mail = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  assert.deepEqual(
    mail.map((row) => row.to),
    ["bob@friendloop.test", "owner@friendloop.test"],
  );

  // One reminder each, no matter how often the sweep runs.
  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() - 23 * HOUR) })).reminded, 0);
});

test("a reader and a removed member are never reminded", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await rows("update memberships set participation = 'reader' where email = 'alice@friendloop.test'");
  await rows("update memberships set revoked_at = $1 where id = $2", [E2E_NOW.toISOString(), bob.id]);

  const report = await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) });
  const mail = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder'");
  assert.equal(report.reminded, 1);
  assert.deepEqual(mail.map((row) => row.to), ["owner@friendloop.test"]);
});

test("a round with no questions produces no reminder", async () => {
  const loop = await seedLoop({ questions: [] });
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) })).reminded, 0);
});

test("the sweep reports how much of the outbox it retried", async () => {
  await rows(
    `insert into outbox ("to", subject, html, text, kind, dedupe_key, status)
     values ('x@y.test', 'Subject', '<p>body</p>', 'body', 'prompt', 'retry:1', 'failed')`,
  );

  const report = await sweep({ at: BEFORE_FIRST_SLOT });
  assert.equal(report.retried, 1);

  const [row] = await rows<{ status: string }>("select status from outbox where dedupe_key = 'retry:1'");
  assert.equal(row.status, "sent");
});

test("pendingWork describes what a sweep at this instant would act on", async () => {
  const loop = await seedLoop();
  const quiet = await sweep({ at: BEFORE_FIRST_SLOT });
  assert.equal(quiet.opened, 0);

  const before = await pendingWork(BEFORE_FIRST_SLOT);
  assert.equal(before.loops, 1);
  assert.equal(before.dueSlots, 0);
  assert.equal(before.openIssues, 0);

  await sweep({ at: AFTER_FIRST_SLOT });
  const due = await pendingWork(AFTER_FIRST_SLOT);
  assert.equal(due.openIssues, 1);
  assert.equal(loop.groupId.length, 36);
});

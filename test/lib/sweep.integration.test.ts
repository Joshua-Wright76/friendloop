import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pendingWork, sweep } from "../../src/lib/sweep.ts";
import { outboxCount, resetDatabase, rows, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DAY, DELIVERY_DAY, E2E_NOW, HOUR } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const ALICE_QUESTION = "What made you laugh this week?";

type IssueRow = { id: string; number: number; status: string; opens_at: Date; delivers_at: Date; slot_at: Date };

async function issuesOf(groupId: string): Promise<IssueRow[]> {
  return rows<IssueRow>(
    "select id, number, status, opens_at, delivers_at, slot_at from issues where group_id = $1 order by number",
    [groupId],
  );
}

setupDatabase();

test("a paused loop opens nothing", async () => {
  const loop = await seedLoop();
  await rows("update groups set paused_at = $1 where id = $2", [BEFORE_FIRST_SLOT.toISOString(), loop.groupId]);

  const report = await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal(report.opened, 0);
  assert.equal(await outboxCount("prompt:"), 0);
});

test("a running loop without a round gets one at once, due at the next delivery", async () => {
  const loop = await seedLoop();
  const report = await sweep({ at: BEFORE_FIRST_SLOT });

  assert.equal(report.opened, 1);
  const [issue] = await issuesOf(loop.groupId);
  assert.equal(issue.number, 1);
  assert.equal(issue.status, "open");
  assert.equal(new Date(issue.opens_at).toISOString(), BEFORE_FIRST_SLOT.toISOString());
  // Friday 09:00 Amsterdam, a day away: answers are welcome up to the last moment.
  assert.equal(new Date(issue.delivers_at).toISOString(), "2026-01-02T08:00:00.000Z");
  assert.equal(await outboxCount("prompt:"), 3, "every contributor gets the questions");

  // It opened inside the reminder window, so the prompt it just sent is enough.
  assert.equal((await sweep({ at: new Date(BEFORE_FIRST_SLOT.getTime() + HOUR) })).reminded, 0);
});

test("a loop with no questions opens a round and sends nothing", async () => {
  const loop = await seedLoop({ questions: [] });
  const report = await sweep({ at: AFTER_FIRST_SLOT });

  assert.equal(report.opened, 1);
  assert.equal(await outboxCount("prompt:"), 0);
  const [issue] = await issuesOf(loop.groupId);
  assert.equal(issue.status, "open");
});

test("a second sweep opens nothing more", async () => {
  const loop = await seedLoop();
  assert.equal((await sweep({ at: AFTER_FIRST_SLOT })).opened, 1);
  assert.equal((await sweep({ at: AFTER_FIRST_SLOT })).opened, 0);
  assert.equal((await issuesOf(loop.groupId)).length, 1);
  assert.equal(await outboxCount("prompt:"), 3);
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

test("delivery opens the next round, and its questions ride along in each writer's email", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("update memberships set participation = 'reader' where id = $1", [bob.id]);
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: ALICE_QUESTION, body: "Yes." }] });

  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.delivered, 1);
  assert.equal(report.opened, 1);

  const [, next] = await issuesOf(loop.groupId);
  assert.equal(next.number, 2);
  assert.equal(next.status, "open");
  assert.equal(new Date(next.opens_at).toISOString(), DELIVERY_DAY.toISOString());
  // The Friday after this one: a round runs from one delivery to the next.
  assert.equal(new Date(next.delivers_at).toISOString(), "2026-01-16T08:00:00.000Z");

  // No separate prompt: the delivery carries the next round's questions instead.
  assert.equal(await outboxCount("prompt:"), 0);
  const mail = await rows<{ to: string; html: string; text: string }>(
    "select \"to\", html, text from outbox where kind = 'delivery' order by \"to\"",
  );
  const forAlice = mail.find((row) => row.to === alice.email)!;
  assert.match(forAlice.html, /Next up: Round 2/);
  assert.ok(forAlice.html.includes(`/r/${alice.token}`), "alice's own reply link");
  assert.ok(forAlice.text.includes(`/r/${alice.token}`));
  const forBob = mail.find((row) => row.to === bob.email)!;
  assert.doesNotMatch(forBob.html, /Next up/, "a reader has nothing to answer");
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
  assert.equal((await issuesOf(loop.groupId)).length, 2, "one next round, not two");
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

test("an empty round carries over to the next delivery, twice, then pauses the loop", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  const first = await sweep({ at: DELIVERY_DAY });
  assert.equal(first.carried, 1);
  assert.equal(first.skipped, 0);
  assert.equal(first.opened, 0);
  let [row] = await issuesOf(loop.groupId);
  assert.equal(row.status, "open");
  assert.equal(new Date(row.delivers_at).toISOString(), "2026-01-16T08:00:00.000Z");

  const second = await sweep({ at: new Date("2026-01-16T08:05:00Z") });
  assert.equal(second.carried, 1);
  [row] = await issuesOf(loop.groupId);
  assert.equal(new Date(row.delivers_at).toISOString(), "2026-01-23T08:00:00.000Z");
  assert.equal(await outboxCount("delivery:"), 0);
  assert.equal(await outboxCount("skipped:"), 0);

  const third = await sweep({ at: new Date("2026-01-23T08:05:00Z") });
  assert.equal(third.skipped, 1);
  assert.equal(third.opened, 0, "a loop that pauses itself opens nothing in the same sweep");

  const [skipped] = await rows<{ status: string; skipped_at: Date | null }>(
    "select status, skipped_at from issues where id = $1",
    [issue.issueId],
  );
  assert.equal(skipped.status, "skipped");
  assert.ok(skipped.skipped_at);
  const [group] = await rows<{ paused_at: Date | null }>("select paused_at from groups where id = $1", [loop.groupId]);
  assert.ok(group.paused_at);
  const notes = await rows<{ to: string }>("select \"to\" from outbox where kind = 'nudge'");
  assert.deepEqual(notes.map((note) => note.to), ["owner@friendloop.test"], "only the owner is told");
  assert.equal((await issuesOf(loop.groupId)).length, 1);
});

test("an answer that arrives after a carry-over goes out at the new delivery", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  assert.equal((await sweep({ at: DELIVERY_DAY })).carried, 1);
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: ALICE_QUESTION, body: "Late but here." }] });

  const report = await sweep({ at: new Date("2026-01-16T08:05:00Z") });
  assert.equal(report.delivered, 1);
  assert.equal(await outboxCount("delivery:"), 3);
});

test("skipping is idempotent and never re-pauses", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  // Already carried over twice: this delivery is its third empty one.
  await rows("update issues set slot_at = delivers_at - interval '14 days' where id = $1", [issue.issueId]);

  assert.equal((await sweep({ at: DELIVERY_DAY })).skipped, 1);
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

test("a round carried over earns one more reminder before its new delivery", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) })).reminded, 3);
  assert.equal((await sweep({ at: DELIVERY_DAY })).carried, 1);
  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() + 6 * DAY) })).reminded, 3);
  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() + 6 * DAY + HOUR) })).reminded, 0);
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

test("a paused loop holds its round: no delivery, no reminder", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: ALICE_QUESTION, body: "Held." }] });
  await rows("update groups set paused_at = $1 where id = $2", [AFTER_FIRST_SLOT.toISOString(), loop.groupId]);

  assert.equal((await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) })).reminded, 0);
  const report = await sweep({ at: DELIVERY_DAY });
  assert.equal(report.delivered, 0);
  assert.equal(report.carried, 0);
  const [row] = await issuesOf(loop.groupId);
  assert.equal(row.status, "open");
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

  const before = await pendingWork(BEFORE_FIRST_SLOT);
  assert.equal(before.loops, 1);
  assert.equal(before.dueSlots, 1, "a loop without a round");
  assert.equal(before.openIssues, 0);

  await sweep({ at: BEFORE_FIRST_SLOT });
  const quiet = await pendingWork(BEFORE_FIRST_SLOT);
  assert.equal(quiet.dueSlots, 0);
  assert.equal(quiet.openIssues, 1);

  const due = await pendingWork(AFTER_FIRST_SLOT);
  assert.equal(due.dueSlots, 1, "its delivery has come");
  assert.equal(loop.groupId.length, 36);
});

test("a sweep that finds another one running does nothing and says so", async () => {
  await seedLoop();
  const { db } = await import("../../src/db/index.ts");
  const { sql } = await import("drizzle-orm");

  // Hold the sweep lock the way a concurrent trigger would, then sweep.
  const report = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7311002)`);
    return sweep({ at: AFTER_FIRST_SLOT });
  });
  assert.equal(report.busy, true);
  assert.equal(report.opened, 0);

  // Released with the transaction: the next sweep does the work.
  const next = await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal(next.busy, false);
  assert.equal(next.opened, 1);
});

test("two triggers at the same instant open one round between them", async () => {
  const loop = await seedLoop();
  const [a, b] = await Promise.all([sweep({ at: AFTER_FIRST_SLOT }), sweep({ at: AFTER_FIRST_SLOT })]);
  assert.equal(a.opened + b.opened, 1);
  assert.equal((await issuesOf(loop.groupId)).length, 1);
});

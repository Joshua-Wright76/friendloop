import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

/**
 * Production has two triggers for the same sweep (Vercel cron and GitHub
 * Actions), so "late, twice, or out of order" is the normal case, not an edge
 * case. D2 proves the second call is a no-op when it arrives *after* the first
 * one committed; this proves the case where both are in flight at once.
 */
test("D11 · two triggers at the same instant open one round", async () => {
  const loop = await seedLoop();

  const [first, second] = await Promise.all([
    runSweep(AFTER_FIRST_SLOT),
    runSweep(AFTER_FIRST_SLOT),
  ]);

  expect(
    first.opened + second.opened,
    "exactly one trigger may claim the slot",
  ).toBe(1);

  const issues = await rows<{ count: number }>(
    "select count(*)::int as count from issues where group_id = $1",
    [loop.groupId],
  );
  expect(issues[0].count).toBe(1);

  const prompts = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'prompt'",
  );
  expect(prompts[0].count, "one prompt per contributor, not one per trigger").toBe(3);

  // The slot is recorded once, so the next sweep has nothing left to do.
  const after = await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + 60_000));
  expect(after.opened).toBe(0);
});

test("D11 · concurrent delivery and reminder passes never double-send", async () => {
  const loop = await seedLoop();
  const open = await runSweep(AFTER_FIRST_SLOT);
  expect(open.opened).toBe(1);

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions order by position limit 1",
  );
  await rows(
    `insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
     select i.id, $1, $2, 'One answer.', 'submitted', $3 from issues i where i.group_id = $4 limit 1`,
    [question.id, alice.id, AFTER_FIRST_SLOT.toISOString(), loop.groupId],
  );

  // Two days before delivery the reminder window is open and delivery is not:
  // run the sweep twice at once, exactly as two triggers would.
  const reminderDay = new Date("2026-01-07T09:00:00Z");
  const reports = await Promise.all([runSweep(reminderDay), runSweep(reminderDay)]);
  expect(reports.reduce((total, report) => total + report.reminded, 0)).toBe(2);

  const reminders = await rows<{ dedupe_key: string }>(
    "select dedupe_key from outbox where kind = 'reminder' order by dedupe_key",
  );
  expect(reminders).toHaveLength(2);
  expect(new Set(reminders.map((row) => row.dedupe_key)).size).toBe(2);

  // Delivery at once, twice: the issue is delivered once and each member gets
  // exactly one copy.
  const [deliveryA, deliveryB] = await Promise.all([
    runSweep(new Date("2026-01-09T08:05:00Z")),
    runSweep(new Date("2026-01-09T08:05:00Z")),
  ]);
  expect(deliveryA.delivered + deliveryB.delivered).toBe(1);

  const deliveries = await rows<{ to: string }>(
    "select \"to\" from outbox where kind = 'delivery' order by \"to\"",
  );
  expect(deliveries).toHaveLength(3);
});

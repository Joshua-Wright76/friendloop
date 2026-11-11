import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D1 · the sweep opens a round and emails every contributor once", async () => {
  const loop = await seedLoop();

  const report = await runSweep(AFTER_FIRST_SLOT);
  expect(report.opened).toBe(1);

  const issues = await rows<{ number: number; status: string }>(
    "select number, status from issues where group_id = $1",
    [loop.groupId],
  );
  expect(issues).toHaveLength(1);
  expect(issues[0].status).toBe("open");

  const snapshots = await rows<{ count: number }>(
    "select count(*)::int as count from issue_questions",
  );
  expect(snapshots[0].count).toBe(2);

  const prompts = await rows<{ to: string }>(
    "select \"to\" from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(prompts.map((row) => row.to)).toEqual([
    "alice@friendloop.test",
    "bob@friendloop.test",
    "owner@friendloop.test",
  ]);
});

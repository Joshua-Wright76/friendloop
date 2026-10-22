import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D2 · nothing opens before the slot, and nothing opens twice", async () => {
  const loop = await seedLoop();

  const early = await runSweep(new Date("2026-01-01T07:59:00Z"));
  expect(early.opened).toBe(0);

  expect((await runSweep(AFTER_FIRST_SLOT)).opened).toBe(1);
  expect((await runSweep(AFTER_FIRST_SLOT)).opened).toBe(0);

  const issues = await rows<{ count: number }>(
    "select count(*)::int as count from issues where group_id = $1",
    [loop.groupId],
  );
  expect(issues[0].count).toBe(1);

  const prompts = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'prompt'",
  );
  expect(prompts[0].count, "no duplicate prompt emails").toBe(3);
});

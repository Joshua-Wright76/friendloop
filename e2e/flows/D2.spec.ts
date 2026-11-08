import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { BEFORE_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D2 · a second sweep, or two at once, opens nothing twice", async () => {
  const loop = await seedLoop();

  const [first, second] = await Promise.all([runSweep(BEFORE_FIRST_SLOT), runSweep(BEFORE_FIRST_SLOT)]);
  expect(first.opened + second.opened).toBe(1);
  expect((await runSweep(new Date(BEFORE_FIRST_SLOT.getTime() + 60 * 60 * 1000))).opened).toBe(0);

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

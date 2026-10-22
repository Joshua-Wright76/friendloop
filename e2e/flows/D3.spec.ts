import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D3 · send now opens a round at once and the schedule does not duplicate it", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}`);
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText(/Round 1 is open and everyone/)).toBeVisible();

  const opened = await rows<{ count: number }>(
    "select count(*)::int as count from issues where group_id = $1 and status = 'open'",
    [loop.groupId],
  );
  expect(opened[0].count).toBe(1);

  const prompts = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'prompt'",
  );
  expect(prompts[0].count).toBe(3);

  await runSweep(AFTER_FIRST_SLOT);
  const after = await rows<{ count: number }>(
    "select count(*)::int as count from issues where group_id = $1",
    [loop.groupId],
  );
  expect(after[0].count, "the scheduled slot must not open a second round").toBe(1);
});

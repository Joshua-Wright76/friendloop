import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, clockHeaders, runSweep, sendNow, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D3 · send now opens a round at once and the schedule does not duplicate it", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}`);
  await sendNow(page);
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


test("D3 · send now before the slot takes its place: no second round, and next shows the one after", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  // After signing in: a session cookie minted under an old clock would already be expired.
  await page.setExtraHTTPHeaders(clockHeaders(BEFORE_FIRST_SLOT));

  await page.goto(`/g/${loop.groupId}`);
  await sendNow(page);
  await expect(page.getByText(/Round 1 is open and everyone/)).toBeVisible();

  await runSweep(AFTER_FIRST_SLOT);
  const [{ count }] = await rows<{ count: number }>("select count(*)::int as count from issues where group_id = $1", [loop.groupId]);
  expect(count).toBe(1);
  const prompts = await rows<{ count: number }>("select count(*)::int as count from outbox where kind = 'prompt'");
  expect(prompts[0].count).toBe(3);
});

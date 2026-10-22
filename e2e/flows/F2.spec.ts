import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F2 · paused loops open nothing; resuming starts from now", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}`);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Nothing scheduled")).toBeVisible();

  const paused = await runSweep(AFTER_FIRST_SLOT);
  expect(paused.opened).toBe(0);

  await page.goto(`/g/${loop.groupId}/settings`);
  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  const [group] = await rows<{ paused_at: string | null; last_slot_at: string | null }>(
    "select paused_at, last_slot_at from groups where id = $1",
    [loop.groupId],
  );
  expect(group.paused_at).toBeNull();
  expect(group.last_slot_at).not.toBeNull();
});

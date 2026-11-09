import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, clockHeaders, openPart, runSweep, signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F2 · a paused loop holds its round; resuming picks it back up", async ({ page }) => {
  const loop = await seedLoop();
  await runSweep(AFTER_FIRST_SLOT);
  await signIn(page, "owner@friendloop.test");
  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));

  await page.goto(`/g/${loop.groupId}`);
  await page.getByRole("button", { name: copy.loop.pause }).click();
  await expect(page.getByText(copy.loop.pausedDescription)).toBeVisible();

  // Its delivery comes and goes, and nothing is sent or carried.
  const paused = await runSweep(new Date("2026-01-09T08:05:00Z"));
  expect(paused.delivered + paused.carried + paused.opened).toBe(0);

  // Resumed after the day it was due: the same round, going out on the next one.
  await page.setExtraHTTPHeaders(clockHeaders(new Date("2026-01-12T12:00:00Z")));
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupKeep);
  await page.getByRole("button", { name: copy.settings.resume }).click();
  await expect(page.getByRole("button", { name: copy.settings.pause })).toBeVisible();

  // The button changes before the write behind it lands, so wait for that.
  const state = async () =>
    (await rows<{ paused_at: string | null; delivers_at: string; count: number }>(
      `select g.paused_at, i.delivers_at, (select count(*)::int from issues where group_id = g.id) as count
       from groups g join issues i on i.group_id = g.id and i.status = 'open' where g.id = $1`,
      [loop.groupId],
    ))[0];
  // Unpausing and rescheduling are two writes, so wait for the second.
  await expect.poll(async () => new Date((await state()).delivers_at).toISOString()).toBe("2026-01-16T08:00:00.000Z");
  expect((await state()).paused_at).toBeNull();
  expect((await state()).count).toBe(1);
});

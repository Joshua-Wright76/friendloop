import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B6 · an invitation nobody opened for two weeks is dead", async ({ page }) => {
  const loop = await seedLoop();
  const stale = await addMember(loop, {
    email: "slow@friendloop.test",
    invitedDaysAgo: 30,
    accepted: false,
  });

  await page.goto(`/r/${stale.token}`);

  await expect(page.getByRole("heading", { name: /invitation has expired/i })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);

  const writes = await rows<{ count: number }>("select count(*)::int as count from replies");
  expect(writes[0].count).toBe(0);
});

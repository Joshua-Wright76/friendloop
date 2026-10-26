import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F4 · deleting a loop takes everything with it", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/settings`);
  await page.getByLabel("Loop name").fill("Friday Loop");
  await page.getByRole("button", { name: "Delete forever" }).click();

  await expect(page).toHaveURL(/\/you(\?.*)?$/);

  const groups = await rows<{ count: number }>("select count(*)::int as count from groups");
  const members = await rows<{ count: number }>("select count(*)::int as count from memberships");
  expect(groups[0].count).toBe(0);
  expect(members[0].count).toBe(0);

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("This page isn't here")).toBeVisible();
});

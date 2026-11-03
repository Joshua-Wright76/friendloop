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
  const confirm = page.getByLabel("Type “Friday Loop” to confirm");
  const deleteButton = page.getByRole("button", { name: "Delete forever" });
  // The field starts empty, and the button waits for the exact name.
  await expect(confirm).toHaveValue("");
  await expect(deleteButton).toHaveAttribute("aria-disabled", "true");
  await confirm.fill("Friday");
  await deleteButton.click();
  await expect(page).toHaveURL(/\/settings$/);
  await confirm.fill("Friday Loop");
  await expect(deleteButton).not.toHaveAttribute("aria-disabled");
  await page.getByRole("button", { name: "Delete forever" }).click();

  await expect(page).toHaveURL(/\/you(\?.*)?$/);

  const groups = await rows<{ count: number }>("select count(*)::int as count from groups");
  const members = await rows<{ count: number }>("select count(*)::int as count from memberships");
  expect(groups[0].count).toBe(0);
  expect(members[0].count).toBe(0);

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("This page isn't here")).toBeVisible();
});

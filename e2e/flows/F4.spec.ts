import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, signIn } from "../support/harness";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F4 · deleting a loop takes everything with it", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupDanger);
  const confirm = page.getByLabel(text(copy.settings.deleteConfirmLabel, { name: "Friday Loop" }));
  const deleteButton = page.getByRole("button", { name: copy.settings.delete });
  // The field starts empty, and the button waits for the exact name.
  await expect(confirm).toHaveValue("");
  await expect(deleteButton).toHaveAttribute("aria-disabled", "true");
  await confirm.fill("Friday");
  await expect(deleteButton).toHaveAttribute("aria-disabled", "true");
  await confirm.fill("Friday Loop");
  await expect(deleteButton).not.toHaveAttribute("aria-disabled");
  await page.getByRole("button", { name: copy.settings.delete }).click();

  await expect(page).toHaveURL(/\/you(\?.*)?$/);

  const groups = await rows<{ count: number }>("select count(*)::int as count from groups");
  const members = await rows<{ count: number }>("select count(*)::int as count from memberships");
  expect(groups[0].count).toBe(0);
  expect(members[0].count).toBe(0);

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(copy.common.notFound.title)).toBeVisible();
});

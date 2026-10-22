import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B1 · creating a loop makes you its owner and lands on it", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signIn(page, email);

  await page.getByRole("link", { name: "New loop" }).click();
  await page.getByLabel("Name").fill("The Sunday Loop");
  await page.getByRole("checkbox", { name: /What made you laugh this week/ }).first().check();
  await page.getByRole("button", { name: "Create loop" }).click();

  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+\?welcome=1/);
  await expect(page.getByRole("heading", { name: "The Sunday Loop" })).toBeVisible();
  await expect(page.getByText(/Loop created/)).toBeVisible();

  const owners = await rows<{ access: string; participation: string }>(
    `select m.access, m.participation from memberships m
     join groups g on g.id = m.group_id where g.name = $1`,
    ["The Sunday Loop"],
  );
  expect(owners).toHaveLength(1);
  expect(owners[0]).toEqual({ access: "owner", participation: "contributor" });
});

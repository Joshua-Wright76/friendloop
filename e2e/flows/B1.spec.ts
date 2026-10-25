import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";

const NEXT = "Continue to the next setup step";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B1 · creating a group loop saves its cadence and makes you its owner", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signIn(page, email);

  await page.getByRole("link", { name: "New loop" }).click();
  await expect(page.getByRole("progressbar", { name: "Loop setup progress" })).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByRole("progressbar", { name: "Loop setup progress" })).toHaveAttribute("aria-valuenow", "2");
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await expect(page.getByRole("progressbar", { name: "Loop setup progress" })).toHaveAttribute("aria-valuenow", "1");
  await page.getByLabel("Loop title").fill("The Sunday Loop");
  await page.getByRole("button", { name: "Quarterly (13 weeks)" }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Create this loop" }).click();

  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+\?welcome=1/);
  await expect(page.getByRole("heading", { name: "The Sunday Loop" })).toBeVisible();
  await expect(page.getByText(/Loop created/)).toBeVisible();

  const group = await rows<{ mode: string; cadence_weeks: number }>(
    "select mode, cadence_weeks from groups where name = $1",
    ["The Sunday Loop"],
  );
  expect(group).toEqual([{ mode: "group", cadence_weeks: 13 }]);

  const owners = await rows<{ access: string; participation: string }>(
    `select m.access, m.participation from memberships m
     join groups g on g.id = m.group_id where g.name = $1`,
    ["The Sunday Loop"],
  );
  expect(owners).toHaveLength(1);
  expect(owners[0]).toEqual({ access: "owner", participation: "contributor" });
});

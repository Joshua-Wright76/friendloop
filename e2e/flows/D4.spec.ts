import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

async function openSheet(page: import("@playwright/test").Page) {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  return { loop, alice };
}

test("D4 · typing is saved as a draft and survives a reload", async ({ page }) => {
  await openSheet(page);

  const answer = page.getByLabel("What made you laugh this week?");
  await answer.fill("The dog, the baguette, the whole thing.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("What made you laugh this week?")).toHaveValue(
    "The dog, the baguette, the whole thing.",
  );
  await expect(page.getByText(/1 of 2 answered/i).first()).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C1 · a custom question joins the pool at the end", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByLabel("New question").fill("What did you learn this week?");
  await page.getByRole("button", { name: "Add question" }).click();

  await expect(page.getByText("Question added.")).toBeVisible();
  const items = page.locator("ol > li");
  await expect(items.last()).toContainText("What did you learn this week?");
});

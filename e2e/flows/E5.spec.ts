import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E5 · the archive lists rounds newest first and old ones still open", async ({ page }) => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-23T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Older answer." }],
  });
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Newer answer." }],
  });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/issues`);
  const cards = page.locator("main .card");
  await expect(cards.first()).toContainText("Round 2");
  await expect(cards.nth(1)).toContainText("Round 1");

  await cards.nth(1).getByRole("link", { name: /^Read the issue/ }).click();
  await expect(page.getByText("Older answer.")).toBeVisible();
});

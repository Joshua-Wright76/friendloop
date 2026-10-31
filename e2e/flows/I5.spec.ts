import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("I5 · from_you loops never offer suggestions", async ({ page }) => {
  const loop = await seedLoop({ mode: "from_you", members: [] });
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });

  // The owner is the only contributor in from_you; even their sheet stays quiet.
  await page.goto(`/r/${loop.ownerToken}`);
  await expect(page.getByRole("link", { name: "Have a question for the group? Suggest one" })).toHaveCount(0);

  await page.goto(`/r/${loop.ownerToken}/suggest`);
  await expect(page.getByText("Not available here")).toBeVisible();
});

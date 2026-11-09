import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A6 · a replaced reply link is refused and leaks nothing", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await rows("update memberships set revoked_at = now() where id = $1", [alice.id]);

  await page.goto(`/r/${alice.token}`);

  await expect(page.getByRole("heading", { name: /doesn't work anymore/i })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.getByText(copy.questionPacks[0].questions[0])).toHaveCount(0);
});

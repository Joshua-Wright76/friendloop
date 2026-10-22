import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E4 · reacting toggles on and off", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a heart." }],
  });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  const heart = page.getByRole("button", { name: /React with ❤️/ }).first();
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");

  const after = await rows<{ count: number }>("select count(*)::int as count from reactions");
  expect(after[0].count).toBe(1);

  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  const cleared = await rows<{ count: number }>("select count(*)::int as count from reactions");
  expect(cleared[0].count).toBe(0);
});

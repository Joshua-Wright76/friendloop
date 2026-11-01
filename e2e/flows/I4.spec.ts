import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("I4 · readers and dead tokens get walls, not forms", async ({ page }) => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "reader@friendloop.test", name: "Rita", participation: "reader" },
    ],
  });
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const rita = loop.members.find((member) => member.email.startsWith("reader"))!;

  await page.goto(`/r/${rita.token}/suggest`);
  await expect(page.getByText("Not available here")).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveCount(0);

  const refused = await page.request.post(`/api/suggest/${rita.token}`, {
    data: { text: "Why is the sky blue?", authorDisplay: "name" },
  });
  expect(refused.status()).toBe(403);

  // A rotated (revoked) token shows the replaced-link screen, with no form.
  await page.goto(`/r/${alice.token}-rotated/suggest`);
  await expect(page.getByText("This link doesn't work anymore")).toBeVisible();
  await expect(page.getByLabel("Your question")).toHaveCount(0);
});

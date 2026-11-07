import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F7 · fixing a typo in someone's address invites the right one and retires the old link", async ({ page }) => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const card = page.locator(".card").filter({ hasText: bob.email });
  await card.getByRole("button", { name: /^Fix address for/ }).click();
  await card.getByLabel("New email address").fill("robert@friendloop.test");
  await card.getByRole("button", { name: "Send invite there" }).click();
  await expect(page.getByText("Address changed, and a new invitation is on its way.")).toBeVisible();
  await expect(page.locator(".card").filter({ hasText: "robert@friendloop.test" })).toBeVisible();

  const invites = await rows<{ count: number }>(`select count(*)::int as count from outbox where kind = 'invite' and "to" = 'robert@friendloop.test'`);
  expect(invites[0].count).toBe(1);

  await page.goto(`/r/${bob.token}`);
  await expect(page.getByRole("heading", { name: /replaced|doesn't work/i })).toBeVisible();
});

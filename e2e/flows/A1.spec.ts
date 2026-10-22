import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A1 · requesting a link sends exactly one and points at the inbox", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();

  await expect(page).toHaveURL(/\/signin\/check-email$/);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const sent = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'signin'",
  );
  expect(sent[0].count).toBe(1);

  const mail = await latestOutbox("signin:");
  expect(mail?.to).toBe(email);
  expect(mail?.html).toContain("/signin/confirm?token=");
});

test("A1 · a malformed address never reaches the server", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Your email").fill("not-an-email");
  await page.getByRole("button", { name: "Email me a link" }).click();

  // The field is type=email, so the browser refuses to submit it at all.
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByLabel("Your email")).toHaveValue("not-an-email");

  const sent = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'signin'",
  );
  expect(sent[0].count).toBe(0);
});

import { test, expect } from "@playwright/test";
import { latestOutbox, linkFrom, resetDatabase } from "../support/db";
import { uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A2 · the emailed link signs you in and puts you on your own page", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const mail = await latestOutbox("signin:");
  const link = linkFrom(mail.html, "/signin/confirm");

  await page.goto(link);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/you$/);
  await expect(page.getByRole("heading", { name: "Your loops" })).toBeVisible();
  // Scoped on purpose: navigation keeps the previous route mounted, so the bare
  // address also matches the confirm page's heading.
  await expect(page.locator("header").getByText(email, { exact: true })).toBeVisible();
});

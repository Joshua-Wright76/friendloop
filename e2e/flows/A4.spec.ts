import { test, expect } from "@playwright/test";
import { latestOutboxFor, linkFrom, resetDatabase, rows } from "../support/db";
import { uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A4 · an unknown address leaves the same trace as a known one", async ({ page }) => {
  const known = uniqueEmail("known");
  const unknown = uniqueEmail("stranger");

  // A known address: sign in once so the account exists.
  await page.goto("/signin");
  await page.getByLabel("Your email").fill(known);
  await page.getByRole("button", { name: "Email me a link" }).click();
  const mail = await latestOutboxFor(known);
  await page.goto(linkFrom(mail!.html, "/signin/confirm"));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/you$/);

  await page.context().clearCookies();

  // The unknown one gets the identical screen.
  await page.goto("/signin");
  await page.getByLabel("Your email").fill(unknown);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();

  const accounts = await rows<{ count: number }>(
    "select count(*)::int as count from users where email = $1",
    [unknown],
  );
  expect(accounts[0].count, "no account is created until the link is used").toBe(0);

  const sent = await latestOutboxFor(unknown);
  expect(sent?.to).toBe(unknown);
});

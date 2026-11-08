import { test, expect } from "@playwright/test";
import { latestOutbox, linkFrom, resetDatabase, rows } from "../support/db";
import { uniqueEmail } from "../support/harness";
import { hashToken } from "../../src/lib/tokens";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A3 · the same link works again, from a second browser", async ({ page, browser }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel("Your email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  // Wait for the action to finish before reading what it wrote — A1 and A2
  // wait for this URL, and reading before it landed is how A3 flaked in CI.
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const mail = await latestOutbox("signin:");
  const link = linkFrom(mail.html, "/signin/confirm");

  await page.goto(link);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/you$/);

  // The phone opened it first; now the laptop.
  const laptop = await browser.newContext();
  const second = await laptop.newPage();
  await second.goto(link);
  await expect(second.getByText(email)).toBeVisible();
  await second.getByRole("button", { name: "Sign in" }).click();
  await expect(second).toHaveURL(/\/you$/);
  await expect(second.getByText(`Signed in as ${email}`, { exact: true })).toBeVisible();
  await laptop.close();
});

test("A3 · a link past its 100 hours says it expired and offers a new one", async ({ page }) => {
  const email = uniqueEmail("owner");
  const token = "expired-link-token";

  await rows(
    `insert into magic_links (email, token_hash, expires_at)
     values ($1, $2, now() - interval '1 minute')`,
    [email, hashToken(token)],
  );

  await page.goto(`/signin/confirm?token=${token}`);
  await expect(page.getByRole("heading", { name: /expired/i })).toBeVisible();
  await page.getByRole("link", { name: "Send me a new link" }).click();
  await expect(page).toHaveURL(/\/signin$/);
});

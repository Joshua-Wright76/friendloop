import { test, expect } from "../support/test";
import { latestOutbox, linkFrom, resetDatabase } from "../support/db";
import { uniqueEmail } from "../support/harness";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A2 · the emailed link signs you in and puts you on your own page", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel(copy.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: copy.signIn.submit }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);

  const mail = await latestOutbox("signin:");
  const link = linkFrom(mail.html, "/signin/confirm");

  await page.goto(link);
  await expect(page.getByText(email)).toBeVisible();
  await page.getByRole("button", { name: copy.emails.signIn.cta }).click();

  await expect(page).toHaveURL(/\/you$/);
  await expect(page.getByRole("heading", { name: copy.you.title })).toBeVisible();
  // The full sentence on purpose: the confirm page, which navigation may keep
  // mounted, also shows the bare address.
  await expect(page.getByText(text(copy.you.signedInAs, { email }), { exact: true })).toBeVisible();
});

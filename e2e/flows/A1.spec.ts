import { test, expect } from "../support/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { uniqueEmail } from "../support/harness";
import { copy, copyPattern, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A1 · requesting a link sends exactly one and points at the inbox", async ({ page }) => {
  const email = uniqueEmail("owner");

  await page.goto("/signin");
  await page.getByLabel(copy.signIn.emailLabel).fill(email);
  await page.getByRole("button", { name: copy.signIn.submit }).click();

  await expect(page).toHaveURL(/\/signin\/check-email$/);
  await expect(page.getByRole("heading", { name: copy.checkEmail.title })).toBeVisible();
  // The address is said back, so a typo is caught here, with a way back to fix it.
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: copy.checkEmail.differentEmail })).toHaveAttribute("href", "/signin");

  const sent = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'signin'",
  );
  expect(sent[0].count).toBe(1);

  const mail = await latestOutbox("signin:");
  expect(mail.to).toBe(email);
  expect(mail.html).toContain("/signin/confirm?token=");
  // The code rides in the subject too, so a phone's notification has it.
  const code = copyPattern(copy.emails.signIn.text, { values: { code: /(\d{6})/ } }).exec(mail.text)?.[1];
  expect(code).toBeTruthy();
  expect(mail.subject).toBe(text(copy.emails.signIn.subject, { code: code ?? "" }));
  // The page that says "check your inbox" is also where the code goes, and it already knows the address.
  await expect(page.getByLabel(copy.checkEmail.codeLabel)).toBeVisible();
  // By role, so the sign-in form navigation keeps mounted (hidden) doesn't count.
  await expect(page.getByRole("textbox", { name: copyPattern(copy.signIn.emailLabel) })).toHaveCount(0);
});

test("A1 · a malformed address never reaches the server", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel(copy.signIn.emailLabel).fill("not-an-email");
  await page.getByRole("button", { name: copy.signIn.submit }).click();

  // The field is type=email, so the browser refuses to submit it at all.
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByLabel(copy.signIn.emailLabel)).toHaveValue("not-an-email");

  const sent = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'signin'",
  );
  expect(sent[0].count).toBe(0);
});

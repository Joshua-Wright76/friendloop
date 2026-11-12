import { test, expect } from "../support/test";
import { latestOutbox, resetDatabase } from "../support/db";
import { seedLoop } from "../support/seed";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("V1 · privacy and terms are a click from the landing page, the sign-in page, and every email", async ({ page, request }) => {
  await page.goto("/");
  // The code is public, and the landing page says where.
  await expect(page.getByRole("link", { name: copy.home.source.link })).toHaveAttribute("href", "https://github.com/Joshua-Wright76/friendloop");
  const footer = page.getByRole("contentinfo");
  await footer.getByRole("link", { name: copy.legal.privacyLink }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: copy.legal.privacy.title })).toBeVisible();
  // Honest about the processors and how to leave.
  for (const processor of ["Vercel", "Neon", "Resend", "Sentry"]) {
    await expect(page.getByText(new RegExp(`^${processor} `))).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: copy.legal.privacy.sections[4].heading })).toBeVisible();

  await page.getByRole("contentinfo").getByRole("link", { name: copy.legal.termsLink }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: copy.legal.terms.title })).toBeVisible();

  await page.goto("/signin");
  await page.getByRole("contentinfo").getByRole("link", { name: copy.legal.privacyLink }).click();
  await expect(page).toHaveURL(/\/privacy$/);

  // Every email carries both links under its footer.
  await seedLoop();
  await page.goto("/signin");
  await page.getByLabel(copy.signIn.emailLabel).fill("owner@friendloop.test");
  await page.getByRole("button", { name: copy.signIn.submit }).click();
  await expect(page).toHaveURL(/\/signin\/check-email$/);
  const mail = await latestOutbox("signin:");
  expect(mail.html).toMatch(/href="http[^"]+\/privacy"/);
  expect(mail.html).toMatch(/href="http[^"]+\/terms"/);

  // Both pages are public: no session, no redirect.
  for (const path of ["/privacy", "/terms"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(200);
  }
});

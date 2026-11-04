import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase } from "../support/db";
import { seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("V1 · privacy and terms are a click from the landing page, the sign-in page, and every email", async ({ page, request }) => {
  await page.goto("/");
  const footer = page.getByRole("navigation", { name: "Legal" });
  await footer.getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { level: 1, name: "What we keep, and why" })).toBeVisible();
  // Honest about the processors and how to leave.
  for (const processor of ["Vercel", "Neon", "Resend", "Sentry"]) {
    await expect(page.getByText(new RegExp(`^${processor} `))).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Taking it with you, and deleting it" })).toBeVisible();

  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1, name: "The ground rules" })).toBeVisible();

  await page.goto("/signin");
  await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);

  // Every email carries both links under its footer.
  await seedLoop();
  await page.goto("/signin");
  await page.getByLabel("Your email").fill("owner@friendloop.test");
  await page.getByRole("button", { name: "Email me a link" }).click();
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

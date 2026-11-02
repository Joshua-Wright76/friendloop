import { test, expect } from "@playwright/test";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test("H1 · the screens and email previews open at their routes", async ({ page }) => {
  const screens = await page.goto("/dev/screens");
  expect(screens?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "UI preview" })).toBeVisible();

  await page.getByRole("link", { name: "Email templates" }).click();
  await expect(page).toHaveURL(/\/dev\/emails$/);
  await expect(page.locator("iframe")).toHaveCount(9);
  await expect(page.getByRole("heading", { name: "Sign-in link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered issue with a share link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Someone mentioned you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Empty round, loop paused" })).toBeVisible();

  // The captured inbox holds live sign-in links and stays locked without the key.
  const locked = await page.goto("/dev/outbox");
  expect(locked?.status(), "the inbox must not open without the key").toBe(404);
});

test("H1 · the key unlocks the captured inbox", async ({ page }) => {
  const locked = await page.goto("/dev/outbox");
  expect(locked?.status()).toBe(404);

  const allowed = await page.goto(`/dev/ui?key=${SECRET}`);
  expect(allowed?.status()).toBe(200);
  await expect(page).toHaveURL(/\/dev\/screens$/);

  await page.goto("/dev/outbox");
  await expect(page.getByRole("heading", { name: "Captured email" })).toBeVisible();
  await expect(page.getByText("live sign-in links")).toBeVisible();

  // The cookie proves the key without carrying it.
  const [previewCookie] = (await page.context().cookies()).filter((cookie) => cookie.name === "fl_preview");
  expect(previewCookie.httpOnly).toBe(true);
  expect(previewCookie.path).toBe("/dev");
  expect(previewCookie.value).not.toContain(SECRET);
});

test("H1 · a wrong key keeps the inbox locked", async ({ page }) => {
  await page.goto("/dev/ui?key=not-the-key");
  const locked = await page.goto("/dev/outbox");
  expect(locked?.status()).toBe(404);
});

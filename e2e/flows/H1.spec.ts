import { test, expect } from "@playwright/test";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test("H1 · without the key, nothing under /dev opens and nobody is signed in", async ({ page }) => {
  for (const path of [
    "/dev/ui",
    "/dev/ui/wear?look=harbour",
    "/dev/ui/signout",
    "/dev/screens",
    "/dev/emails",
    "/dev/outbox",
    "/dev/feedback",
  ]) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} must not open without the key`).toBe(404);
  }
  expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain("fl_session");

  await page.goto("/you");
  await expect(page).toHaveURL(/\/signin/);
});

test("H1 · with the key, the screens and email previews open at their routes", async ({ page }) => {
  await page.goto(`/dev/ui?key=${SECRET}`);
  await expect(page).toHaveURL(/\/dev\/screens$/);
  await expect(page.getByRole("heading", { name: "UI preview" })).toBeVisible();

  await page.getByRole("link", { name: "Email templates" }).click();
  await expect(page).toHaveURL(/\/dev\/emails$/);
  await expect(page.locator("iframe")).toHaveCount(11);
  await expect(page.getByRole("heading", { name: "Sign-in link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered round with a share link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Someone mentioned you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered round with its own stationery and a name" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Empty round, loop paused" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invitation from a loop with its own stationery" })).toBeVisible();
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

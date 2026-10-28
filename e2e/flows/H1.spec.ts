import { test, expect } from "@playwright/test";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test("H1 · the key opens the screens, the email previews, and the captured inbox", async ({ page }) => {
  const denied = await page.goto("/dev/ui");
  expect(denied?.status()).toBe(404);

  const wrong = await page.goto("/dev/ui?key=not-the-key");
  expect(wrong?.status()).toBe(404);

  const allowed = await page.goto(`/dev/ui?key=${SECRET}`);
  expect(allowed?.status()).toBe(200);
  await expect(page).toHaveURL(/\/dev\/screens$/);
  await expect(page.getByRole("heading", { name: "UI preview" })).toBeVisible();

  await page.getByRole("link", { name: "Email templates" }).click();
  await expect(page).toHaveURL(/\/dev\/emails$/);
  await expect(page.locator("iframe")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "Sign-in link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Delivered issue with a share link" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Empty round, loop paused" })).toBeVisible();

  await page.goto("/dev/outbox");
  await expect(page.getByRole("heading", { name: "Captured email" })).toBeVisible();
  await expect(page.getByText("live sign-in links")).toBeVisible();

  // The cookie proves the key without carrying it.
  const [previewCookie] = (await page.context().cookies()).filter((cookie) => cookie.name === "fl_preview");
  expect(previewCookie.httpOnly).toBe(true);
  expect(previewCookie.path).toBe("/dev");
  expect(previewCookie.value).not.toContain(SECRET);
});

test("H1 · without the key every preview route is gone", async ({ page }) => {
  for (const path of ["/dev/screens", "/dev/emails", "/dev/outbox", "/dev/ui/signout"]) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} must not open without the key`).toBe(404);
  }
});

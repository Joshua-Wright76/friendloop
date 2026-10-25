import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("theme switch responds to taps and persists across reloads", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");

  await page.getByRole("button", { name: /switch to dark mode/ }).tap();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("friendloop-theme"))).toBe("dark");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: /switch to light mode/ }).tap();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("friendloop-theme"))).toBe("light");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
});

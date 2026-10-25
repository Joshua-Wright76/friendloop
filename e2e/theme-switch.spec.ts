import { expect, test } from "@playwright/test";

test.use({ hasTouch: true });

test("theme switch responds to taps and persists across reloads", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  const trackTransitions = await page.locator(".theme-switch-track").evaluate((element) => getComputedStyle(element).transitionProperty);
  expect(trackTransitions.split(",").map((property) => property.trim())).not.toContain("background");
  await expect(page.locator(".theme-switch-sun")).toBeAttached();
  await expect(page.locator(".theme-switch-moon")).toBeAttached();

  await page.getByRole("button", { name: /switch to dark mode/ }).tap();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("friendloop-theme"))).toBe("dark");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#241a20");

  await page.getByRole("button", { name: /switch to light mode/ }).tap();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("friendloop-theme"))).toBe("light");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
});

test("theme and stationery motion respects reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const durations = await page.locator(".theme-switch-sun").evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      transition: styles.transitionDuration.split(",").map((duration) => Number.parseFloat(duration)),
      animation: Number.parseFloat(styles.animationDuration),
    };
  });
  expect(durations.transition.every((duration) => duration <= 0.001)).toBe(true);
  expect(durations.animation).toBeLessThanOrEqual(0.001);
});

test("theme switching applies immediately when reduced motion is enabled", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => {
        throw new Error("A theme view transition should not run with reduced motion enabled");
      },
    });
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  await page.getByRole("button", { name: /switch to dark mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

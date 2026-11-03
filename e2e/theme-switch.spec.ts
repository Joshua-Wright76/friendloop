import { expect, test } from "@playwright/test";
import { resetDatabase } from "./support/db";
import { seedLoop, seedOpenIssue } from "./support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "./support/harness";

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
  // Exactly one tag: React re-hoists metadata while hydrating, so media-scoped
  // copies would multiply. The toggle keeps the single tag on the chosen theme.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('meta[name="theme-color"]')).map((meta) =>
          meta.getAttribute("content"),
        ),
      ),
    )
    .toEqual(["#241a20"]);

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

test("on a phone the theme and feedback controls sit after the page, never over it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Desktop keeps the floating corner pills.");
  await resetDatabase();
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const feedback = page.getByRole("button", { name: "Send feedback" });
  const theme = page.locator(".theme-switch");
  expect(await feedback.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  expect(await theme.evaluate((element) => getComputedStyle(element).position)).toBe("static");

  // At the very bottom of the reply sheet, both clear the fixed Send bar.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const bar = await page.locator(".reply-actionbar").boundingBox();
  for (const control of [feedback, theme]) {
    const box = await control.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  }
});

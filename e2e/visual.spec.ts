import { expect, test, type Page } from "./support/test";
import { resetDatabase } from "./support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue } from "./support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "./support/harness";
import { copy, copyPattern } from "@/lib/copy";

/**
 * Layout regressions that a text assertion and an axe run both miss.
 *
 * These are deliberately *not* pixel snapshots: a pixel baseline generated on a
 * Mac fails on a Linux runner, and a suite that only runs on one of them stops
 * running at all. They measure what actually broke — an element that no longer
 * fits, a column that collapsed, a theme that stopped applying its tokens — so
 * they hold on every platform.
 *
 * `VISUAL=1 npx playwright test visual` additionally writes pixel snapshots next
 * to this file for eyeballing a redesign; those are local by design.
 */

test.beforeEach(async () => {
  await resetDatabase();
});

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test("visual · the reply sheet fits a phone without sideways scrolling", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);

  expect(await horizontalOverflow(page), "390px wide: nothing may hang off the side").toBeLessThanOrEqual(1);

  await page.getByLabel(copy.questionPacks[0].questions[0]).fill("A cat fist bump.");
  const done = page.getByRole("button", { name: copy.reply.done, exact: true });
  await expect(done).toBeVisible();

  const box = await done.boundingBox();
  expect(box, "the primary action is on screen").not.toBeNull();
  expect(box!.height, "touch target at least 44px").toBeGreaterThanOrEqual(44);
  expect(box!.y + box!.height, "and inside the viewport").toBeLessThanOrEqual(844 + 1);
  expect(box!.x).toBeGreaterThanOrEqual(0);

  if (process.env.VISUAL === "1") {
    await expect(page).toHaveScreenshot("reply-sheet-phone.png", { fullPage: true });
  }
});

test("visual · a delivered round is one column on a phone", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "First answer." },
      { email: "bob@friendloop.test", body: "Second answer." },
    ],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);

  const answers = page.getByText(/First answer\.|Second answer\./);
  await expect(answers).toHaveCount(2);
  const boxes = await answers.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
  );
  expect(new Set(boxes).size, "answers share one left edge, not two columns").toBe(1);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  if (process.env.VISUAL === "1") {
    await expect(page).toHaveScreenshot("issue-phone.png", { fullPage: true });
  }
});

test("visual · both themes paint from their tokens", async ({ page }) => {
  await page.goto("/");

  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.dataset.theme,
      page: styles.getPropertyValue("--page").trim(),
      card: styles.getPropertyValue("--card").trim(),
      ink: styles.getPropertyValue("--ink").trim(),
      color: getComputedStyle(document.body).color,
    };
  });
  expect(palette.theme).toBe("light");
  expect(palette.page).toBe("#fff3f5");
  expect(palette.ink).toBe("#3d2a30");
  expect(palette.color, "body text comes from --ink").toBe("rgb(61, 42, 48)");

  await page.getByRole("button", { name: copyPattern(copy.common.theme.switchToDark, { flags: "i" }) }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return {
      page: styles.getPropertyValue("--page").trim(),
      ink: styles.getPropertyValue("--ink").trim(),
      color: getComputedStyle(document.body).color,
      card: getComputedStyle(document.querySelector(".card") ?? document.body).backgroundColor,
    };
  });
  expect(dark.page).toBe("#241a20");
  expect(dark.ink).not.toBe(palette.ink);
  expect(dark.color, "body text follows the theme, not a hardcoded color").toBe("rgb(248, 234, 238)");
  expect(dark.card, "cards use the dark token").not.toBe("rgba(0, 0, 0, 0)");

  if (process.env.VISUAL === "1") {
    await expect(page).toHaveScreenshot("home-dark.png", { fullPage: true });
  }
});

test("visual · the sign-in form fits a desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/signin");
  await expect(page.getByLabel(copy.signIn.emailLabel)).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

  const main = await page.locator("main").first().boundingBox();
  expect(main).not.toBeNull();
  expect(main!.width).toBeLessThanOrEqual(1280);
  expect(main!.x).toBeGreaterThanOrEqual(0);
});

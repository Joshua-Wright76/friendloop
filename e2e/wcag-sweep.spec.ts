import { expect, test, type Page } from "@playwright/test";
import { UI_PREVIEW } from "@/lib/ui-preview";
import { resetDatabase } from "./support/db";
import { axeProblems, keyboardProblems, reflowProblems, textSpacingProblems, type Problems } from "./support/wcag";

/**
 * The WCAG 2.2 AA checks that need a browser, over every screen the UI preview
 * links to (/dev/screens is the catalogue, so a new screen is swept the day it is
 * added). accessibility.spec.ts runs axe on states a test has to build by hand;
 * this runs what axe cannot decide, on everything:
 *
 *   2.1.2  no keyboard trap              2.4.7 / 1.4.11  a focus ring you can see
 *   2.4.11 focus is never covered        1.4.10          reflow at 320px
 *   1.4.12 text spacing loses nothing    2.4.2           a page title that says where you are
 *
 * Failures are collected per screen and reported together, so one run is a to-do list.
 */
const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test.use({ reducedMotion: "reduce" });

const P = UI_PREVIEW;
const OWNER = P.ownerToken;
const SCREENS: Array<[label: string, href: string]> = [
  ["Home", "/"],
  ["Check email", "/signin/check-email"],
  ["Confirm sign-in", `/signin/confirm?token=${P.magicToken}`],
  ["Invalid reply link", "/r/not-a-token"],
  ["Your loops", "/you"],
  ["New loop", "/g/new"],
  ["Overview", `/g/${P.groupId}`],
  ["Members", `/g/${P.groupId}/members`],
  ["Questions", `/g/${P.groupId}/questions`],
  ["Rounds", `/g/${P.groupId}/issues`],
  ["Rounds filtered", `/g/${P.groupId}/issues?member=${P.aliceMembershipId}`],
  ["Album", `/g/${P.groupId}/album`],
  ["Settings", `/g/${P.groupId}/settings`],
  ["Reply", `/r/${OWNER}`],
  ["Suggest a question", `/r/${P.aliceToken}/suggest`],
  ["Round", `/i/${P.deliveredIssueId}?m=${OWNER}`],
  ["Round, one person", `/i/${P.deliveredIssueId}?m=${OWNER}&by=${P.aliceMembershipId}`],
  ["Round, by person", `/i/${P.deliveredIssueId}?m=${OWNER}&sort=member`],
  ["Round, print", `/i/${P.deliveredIssueId}?print&m=${OWNER}`],
  ["Album as reader", `/album/${P.groupId}?m=${P.aliceToken}`],
  ["Shared round", `/s/${P.shareToken}`],
  ["Shared round, print", `/s/${P.shareToken}?print`],
  ["Not found", "/no-such-page"],
];

async function enterPreview(page: Page) {
  await page.goto(`/dev/ui?key=${SECRET}&reset=1`);
  await page.waitForURL("**/dev/screens");
}

async function setTheme(page: Page, theme: "light" | "dark") {
  if ((await page.locator("html").getAttribute("data-theme")) === theme) return;
  await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("the sweep covers every screen /dev/screens links to", async ({ page }) => {
  await enterPreview(page);
  const linked = await page.locator("main a[href^='/']").evaluateAll((anchors) => anchors.map((a) => a.getAttribute("href")!));
  const swept = new Set(SCREENS.map(([, href]) => href));
  const skipped = (href: string) => href.startsWith("/dev/");
  expect(linked.filter((href) => !swept.has(href) && !skipped(href)), "add these screens to SCREENS").toEqual([]);
});

for (const [name, href] of SCREENS) {
  test(`WCAG AA sweep · ${name}`, async ({ page }) => {
    test.setTimeout(8 * 60_000);
    await enterPreview(page);
    const problems: Problems = [];

    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(href);
      await settle(page);
      await setTheme(page, theme);
      const label = `${name} ${theme}`;
      // An audit of the sign-in page in place of the screen would pass for the wrong reason.
      expect(new URL(page.url()).pathname, `${label} redirected away from ${href}`).toBe(new URL(href, "http://x").pathname);

      problems.push(...(await axeProblems(page, label)));
      problems.push(...(await keyboardProblems(page, `${label} desktop`)));
      if (theme === "light") {
        problems.push(...(await textSpacingProblems(page, label)));
        // 2.4.2: a title that says where you are. Only the home page may be the bare brand.
        const title = await page.title();
        if (!title.trim()) problems.push(`${label}: empty page title`);
        else if (href !== "/" && title.trim() === "Friendloop") problems.push(`${label}: page has only the default title “${title}”`);
      }

      // A phone: reflow, plus the keyboard pass again, because the fixed
      // feedback and theme buttons cover far more of a small screen.
      await page.setViewportSize({ width: 320, height: 640 });
      await settle(page);
      problems.push(...(await reflowProblems(page, label)));
      problems.push(...(await axeProblems(page, `${label} 320px`)));
      problems.push(...(await keyboardProblems(page, `${label} 320px`)));
      if (theme === "light") problems.push(...(await textSpacingProblems(page, `${label} 320px`)));
    }

    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
}

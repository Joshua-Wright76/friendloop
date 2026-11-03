import { expect, test, type Page } from "@playwright/test";
import { THEME_PRESET_KEYS } from "@/lib/theme";
import { UI_PREVIEW } from "@/lib/ui-preview";
import { resetDatabase, rows } from "./support/db";
import {
  ZOOM_400,
  axeProblems,
  keyboardProblems,
  reflowProblems,
  textSpacingProblems,
  type Problems,
} from "./support/wcag";

/**
 * The WCAG 2.2 AA checks that need a browser, over every screen the UI preview
 * links to (a guard test fails when /dev/screens gains a screen this list lacks).
 * accessibility.spec.ts runs axe on states a test has to build by hand; this runs
 * what axe cannot decide, on everything, in both themes, on a desktop and at 400% zoom:
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
// [label, href, expected status]
const SCREENS: Array<[label: string, href: string, status?: number]> = [
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
  ["Not found", "/no-such-page", 404],
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

/** Everything the sweep checks about one screen in one theme, at both viewports. */
async function sweep(page: Page, name: string, href: string, theme: "light" | "dark", status = 200): Promise<Problems> {
  const problems: Problems = [];
  const label = `${name} ${theme}`;
  const wanted = new URL(href, "http://x").pathname;

  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto(href);
  await settle(page);
  await setTheme(page, theme);
  // An audit of the sign-in page (or a 404) in place of the screen would pass for the wrong reason.
  expect(new URL(page.url()).pathname, `${label} redirected away from ${href}`).toBe(wanted);
  expect(response?.status(), `${label} responded with the wrong status`).toBe(status);
  if (status === 200) await expect(page.locator("h1").first(), `${label} has no heading`).toBeVisible();

  problems.push(...(await axeProblems(page, label)));
  problems.push(...(await keyboardProblems(page, `${label} desktop`)));
  if (theme === "light") {
    problems.push(...(await textSpacingProblems(page, label)));
    // 2.4.2: a title that says where you are. Only the home page may be the bare brand.
    const title = await page.title();
    if (!title.trim()) problems.push(`${label}: empty page title`);
    else if (href !== "/" && title.trim() === "Friendloop") problems.push(`${label}: page has only the default title “${title}”`);
    if ((await page.locator("title").count()) > 1) problems.push(`${label}: more than one <title> element`);
  }

  // 400% zoom: reflow, and the keyboard pass again, because the fixed feedback and
  // theme buttons and the sticky reply bars cover far more of a window this small.
  await page.setViewportSize(ZOOM_400);
  await settle(page);
  problems.push(...(await reflowProblems(page, label)));
  problems.push(...(await axeProblems(page, `${label} 320px`)));
  problems.push(...(await keyboardProblems(page, `${label} 320px`)));
  if (theme === "light") problems.push(...(await textSpacingProblems(page, `${label} 320px`)));
  return problems;
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
  // And the other way: nothing in SCREENS may be a screen the catalogue dropped.
  const known = new Set(linked);
  const stale = SCREENS.filter(([, href]) => href.includes(P.groupId) || href.includes(P.deliveredIssueId)).filter(([, href]) => !known.has(href));
  expect(stale.map(([name]) => name), "these SCREENS entries are no longer linked from /dev/screens").toEqual([]);
});

for (const [name, href, status] of SCREENS) {
  test(`WCAG AA sweep · ${name}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await enterPreview(page);
    const problems: Problems = [];
    for (const theme of ["light", "dark"] as const) problems.push(...(await sweep(page, name, href, theme, status)));
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
}

test("WCAG AA sweep · Sign in, signed out", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const problems: Problems = [];
  for (const theme of ["light", "dark"] as const) problems.push(...(await sweep(page, "Sign in", "/signin", theme)));
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

// The loop pages render in whichever stationery the owner chose, and the accent is
// derived per paper, so every preset (and two hostile accents) is swept, not just the default.
const STATIONERY: Array<[string, string | null, string | null]> = [
  ...THEME_PRESET_KEYS.map((key): [string, string | null, string | null] => [`${key} preset`, key, null]),
  ["a yellow accent", "gingham", "#ffee00"],
  ["a near-black accent", "lilac", "#1b1b1b"],
];

for (const [label, preset, accent] of STATIONERY) {
  test(`WCAG AA sweep · stationery · ${label}`, async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await enterPreview(page);
    await rows("update groups set theme_preset = $1, theme_accent = $2 where id = $3", [preset, accent, P.groupId]);
    const problems: Problems = [];
    for (const [name, href] of [
      ["Overview", `/g/${P.groupId}`],
      ["Settings", `/g/${P.groupId}/settings`],
      ["Reply", `/r/${OWNER}`],
      ["Round", `/i/${P.deliveredIssueId}?m=${OWNER}`],
    ] as const) {
      for (const theme of ["light", "dark"] as const) problems.push(...(await sweep(page, `${name} (${label})`, href, theme)));
    }
    expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
  });
}

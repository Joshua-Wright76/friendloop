import { expect, test, type Page } from "@playwright/test";
import { UI_PREVIEW } from "@/lib/ui-preview";
import { resetDatabase } from "./support/db";
import { ZOOM_400, axeProblems, focusedProblems, keyboardProblems, openAllDetails, reflowProblems, textSpacingProblems, type Problems } from "./support/wcag";

/**
 * WCAG 2.2 AA in the states a plain page load never reaches: an open dialog, a
 * popup, each step of the setup wizard, every disclosure expanded. The sweep in
 * wcag-sweep.spec.ts covers what is on screen at load; this covers what a person
 * opens. Each runs at desktop and phone width, in both themes.
 */
const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";
const P = UI_PREVIEW;

test.use({ reducedMotion: "reduce" });

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "320px", ...ZOOM_400 },
] as const;

async function enterPreview(page: Page) {
  await page.goto(`/dev/ui?key=${SECRET}&reset=1`);
  await page.waitForURL("**/dev/screens");
}

async function setTheme(page: Page, theme: "light" | "dark") {
  if ((await page.locator("html").getAttribute("data-theme")) === theme) return;
  await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

/** Schedule every state at each viewport and in each theme independently. */
function testEverywhere(
  title: string,
  href: string,
  timeout: number,
  body: (page: Page, label: string) => Promise<Problems>,
) {
  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"] as const) {
      test(`${title} · ${theme} ${viewport.name}`, async ({ page }) => {
        test.setTimeout(timeout);
        await enterPreview(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(href);
        expect(new URL(page.url()).pathname, `${viewport.name} ${theme} redirected away from ${href}`).toBe(new URL(href, "http://x").pathname);
        await expect(page.locator("h1").first()).toBeVisible();
        await page.evaluate(async () => { await document.fonts.ready; });
        await setTheme(page, theme);
        const problems = await body(page, `${theme} ${viewport.name}`);
        expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
      });
    }
  }
}

test.beforeEach(async () => {
  await resetDatabase();
});

testEverywhere("WCAG AA states · the feedback dialog", "/", 4 * 60_000, async (page, label) => {
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const out = [
    ...(await axeProblems(page, `feedback ${label}`)),
    ...(await keyboardProblems(page, `feedback ${label}`)),
    ...(await textSpacingProblems(page, `feedback ${label}`)),
    ...(await reflowProblems(page, `feedback ${label}`)),
  ];
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Closing returns focus to the button that opened it.
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeFocused();
  return out;
});

testEverywhere("WCAG AA states · every step of the new-loop wizard, and its validation error", "/g/new", 8 * 60_000, async (page, label) => {
  const NEXT = "Continue to the next setup step";
  const out: Problems = [];
  // Step one refuses to move on without a name, and says so.
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByText("Give the loop a name.")).toBeVisible();
  out.push(...(await axeProblems(page, `wizard error ${label}`)));
  await page.getByLabel("Loop title").fill("The Sunday Loop");
  const progress = page.getByRole("progressbar", { name: "Loop setup progress" });
  const total = Number(await progress.getAttribute("aria-valuemax"));
  expect(total, "the wizard reports no steps").toBeGreaterThan(1);
  for (let step = 1; step <= total; step += 1) {
    await expect(progress).toHaveAttribute("aria-valuenow", String(step));
    out.push(...(await axeProblems(page, `wizard step ${step} ${label}`)));
    out.push(...(await keyboardProblems(page, `wizard step ${step} ${label}`)));
    out.push(...(await textSpacingProblems(page, `wizard step ${step} ${label}`)));
    out.push(...(await reflowProblems(page, `wizard step ${step} ${label}`)));
    if (step === total) break;
    await page.getByRole("button", { name: NEXT }).click();
  }
  return out;
});

testEverywhere("WCAG AA states · pickers keep a visible focus on every option", "/g/new", 4 * 60_000, async (page, label) => {
  const out: Problems = [];
  await page.getByRole("button", { name: /^Timezone:/ }).click();
  const listbox = page.getByRole("listbox").first();
  await expect(listbox).toBeVisible();
  out.push(...(await axeProblems(page, `picker ${label}`, ".picker-popover")));
  out.push(...(await focusedProblems(page, `picker search ${label}`)));
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("ArrowDown");
    out.push(...(await focusedProblems(page, `picker option ${label}`)));
  }
  await page.keyboard.press("Escape");
  return out;
});

// One test per page, viewport, and theme: Playwright shards tests, not their loops.
for (const [name, href] of [
  ["Questions", `/g/${P.groupId}/questions`],
  ["Rounds", `/g/${P.groupId}/issues`],
  ["Settings", `/g/${P.groupId}/settings`],
  ["Members", `/g/${P.groupId}/members`],
  ["Round", `/i/${P.deliveredIssueId}?m=${P.ownerToken}`],
  ["Reply", `/r/${P.ownerToken}`],
] as const) {
  testEverywhere(`WCAG AA states · every disclosure open · ${name}`, href, 10 * 60_000, async (page, label) => {
    const barMenus: Problems = [];
    // The issue bar's menus float over the page, one at a time, like a picker. Each is audited on
    // its own, then tabbed through: focus leaving the bar has to close it, or it covers what's next.
    for (const menu of await page.locator(".issue-bar details").all()) {
      await menu.locator("summary").click();
      barMenus.push(...(await axeProblems(page, `${name} bar menu ${label}`, ".issue-bar")));
      barMenus.push(...(await keyboardProblems(page, `${name} bar menu ${label}`)));
      await menu.evaluate((details: HTMLDetailsElement) => { details.open = false; });
    }
    const opened = await openAllDetails(page, ".issue-bar details");
    const out = [...barMenus, ...(await axeProblems(page, `${name} expanded (${opened}) ${label}`)), ...(await keyboardProblems(page, `${name} expanded ${label}`))];
    if (label.endsWith("320px")) out.push(...(await reflowProblems(page, `${name} expanded ${label}`)));
    return out;
  });
}

testEverywhere("WCAG AA states · the album viewer, keyboard only", `/g/${P.groupId}/album`, 4 * 60_000, async (page, label) => {
  const tile = page.getByRole("button", { name: /^Open photo from/ }).first();
  await expect(tile, "the album has no photo to open").toBeVisible();
  await tile.focus();
  await page.keyboard.press("Enter");
  const viewer = page.getByRole("dialog", { name: "Photo viewer" });
  await expect(viewer).toBeVisible();
  const out = [...(await axeProblems(page, `album viewer ${label}`)), ...(await keyboardProblems(page, `album viewer ${label}`))];
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(tile).toBeFocused();
  return out;
});

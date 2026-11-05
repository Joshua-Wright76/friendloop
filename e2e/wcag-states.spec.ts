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

/** Run `body` at every viewport and theme, starting from a fresh load of `href`. */
async function everywhere(page: Page, href: string, body: (label: string) => Promise<Problems>): Promise<Problems> {
  const problems: Problems = [];
  for (const viewport of VIEWPORTS) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(href);
      expect(new URL(page.url()).pathname, `${viewport.name} ${theme} redirected away from ${href}`).toBe(new URL(href, "http://x").pathname);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await setTheme(page, theme);
      problems.push(...(await body(`${theme} ${viewport.name}`)));
    }
  }
  return problems;
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("WCAG AA states · the feedback dialog", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await enterPreview(page);
  const problems = await everywhere(page, "/", async (label) => {
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
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

test("WCAG AA states · every step of the new-loop wizard, and its validation error", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await enterPreview(page);
  const NEXT = "Continue to the next setup step";
  const problems = await everywhere(page, "/g/new", async (label) => {
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
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

test("WCAG AA states · pickers keep a visible focus on every option", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await enterPreview(page);
  const problems = await everywhere(page, "/g/new", async (label) => {
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
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

test("WCAG AA states · every disclosure open on the management and reading pages", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await enterPreview(page);
  const problems: Problems = [];
  const pages: Array<[string, string]> = [
    ["Questions", `/g/${P.groupId}/questions`],
    ["Rounds", `/g/${P.groupId}/issues`],
    ["Settings", `/g/${P.groupId}/settings`],
    ["Members", `/g/${P.groupId}/members`],
    ["Round", `/i/${P.deliveredIssueId}?m=${P.ownerToken}`],
    ["Reply", `/r/${P.ownerToken}`],
  ];
  for (const [name, href] of pages) {
    problems.push(
      ...(await everywhere(page, href, async (label) => {
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
      })),
    );
  }
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

test("WCAG AA states · the album viewer, keyboard only", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await enterPreview(page);
  const problems = await everywhere(page, `/g/${P.groupId}/album`, async (label) => {
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
  expect(problems, `\n${problems.join("\n")}\n`).toEqual([]);
});

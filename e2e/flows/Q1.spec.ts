import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedOpenIssue } from "../support/seed";
import { PPOLL, PQ1, seedKeepsake } from "../support/print";

test.beforeEach(async () => {
  await resetDatabase();
});

/** What the browser would put on paper: print media, with the reader's screen set to `scheme`. */
async function openPrintView(page: Page, path: string, scheme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.emulateMedia({ colorScheme: scheme, media: "print" });
}

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ["0", "0", "0"]).map(Number).slice(0, 3).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("Q1 · a delivered round prints as chromeless light paper with page breaks, whatever the screen and the theme", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "page.pdf() is chromium only");
  const world = await seedKeepsake();
  const web = `/i/${world.issueId}?m=${world.alice.token}`;

  // The web round offers the print view; following it opens the same round, bare.
  await page.goto(web);
  await page.getByRole("link", { name: "Print this round" }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${world.issueId}\\?print&m=${world.alice.token}`));
  await expect(page.getByRole("heading", { level: 1, name: "Camping weekend" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to the round" })).toHaveAttribute("href", web);

  // Nothing prints itself: arriving on the print view does not open a print dialog, a click does.
  await page.addInitScript(() => {
    const counter = window as unknown as { __prints: number };
    counter.__prints = 0;
    window.print = () => { counter.__prints += 1; };
  });
  const prints = () => page.evaluate(() => (window as unknown as { __prints: number }).__prints);
  await page.reload();
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  expect(await prints()).toBe(0);
  await page.getByRole("button", { name: "Print or save as PDF" }).click();
  expect(await prints()).toBe(1);

  for (const scheme of ["light", "dark"] as const) {
    await openPrintView(page, `/i/${world.issueId}?print&m=${world.alice.token}`, scheme);

    // No chrome: the toolbar, the theme switch and the skip link are gone.
    await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Back to the round" })).toBeHidden();
    await expect(page.locator(".theme-switch")).toBeHidden();
    await expect(page.locator(".feedback-button")).toBeHidden();
    await expect(page.locator(".skip-link")).toBeHidden();

    // Light paper, even when the screen asked for dark.
    const paper = await page.evaluate(() => {
      const sheet = document.querySelector(".print-sheet")!;
      const style = getComputedStyle(sheet);
      const heading = getComputedStyle(document.querySelector("h1")!);
      const body = getComputedStyle(document.querySelector(".print-body")!);
      return {
        background: style.backgroundColor,
        page: style.getPropertyValue("--page").trim(),
        card: style.getPropertyValue("--card").trim(),
        h1: heading.color,
        body: body.color,
        rootBackground: getComputedStyle(document.documentElement).backgroundColor,
        scheme: style.colorScheme,
      };
    });
    expect(paper.background, scheme).toBe("rgb(255, 255, 255)");
    expect(paper.page).toBe("#ffffff");
    expect(paper.card).toBe("#ffffff");
    expect(luminance(paper.h1), `${scheme} heading`).toBeLessThan(0.25);
    expect(luminance(paper.body), `${scheme} body`).toBeLessThan(0.25);
    expect(luminance(paper.rootBackground), `${scheme} page`).toBeGreaterThan(0.9);
    expect(paper.scheme).toBe("light");

    // Page-break control: a page per question, never inside an answer, a photo or a card.
    const breaks = await page.evaluate(() => {
      const value = (selector: string, property: "breakBefore" | "breakInside") =>
        [...document.querySelectorAll(selector)].map((element) => getComputedStyle(element)[property]);
      return {
        questionBefore: value(".print-question", "breakBefore"),
        answerInside: value(".print-answer", "breakInside"),
        figureInside: value(".print-figure", "breakInside"),
        cardInside: value(".print-card", "breakInside"),
        commentInside: value(".print-comment", "breakInside"),
      };
    });
    expect(breaks.questionBefore[0]).toBe("auto");
    expect(breaks.questionBefore.slice(1).every((value) => value === "page")).toBe(true);
    expect(breaks.questionBefore.length).toBeGreaterThanOrEqual(5);
    for (const key of ["answerInside", "figureInside", "cardInside", "commentInside"] as const) {
      expect(breaks[key].length, key).toBeGreaterThan(0);
      expect(breaks[key].every((value) => value === "avoid"), key).toBe(true);
    }

    // It fits the page: nothing pokes out sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${scheme} overflow`).toBeLessThanOrEqual(0);

    // Every picture has an alt attribute and actually loaded.
    const pictures = await page.evaluate(() =>
      [...document.querySelectorAll(".print-sheet main img")].map((img) => ({
        alt: img.getAttribute("alt"),
        loaded: (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
      })),
    );
    expect(pictures.length).toBeGreaterThanOrEqual(5);
    expect(pictures.every((picture) => picture.alt !== null && picture.loaded)).toBe(true);
  }

  // The same content as the web round, laid out for paper: names, not "You".
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Camping weekend");
  await expect(page.getByRole("heading", { level: 2, name: PQ1 })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Alice" }).first()).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toHaveCount(0);
  await expect(page.getByText("asked by Maya")).toBeVisible();
  await expect(page.getByText("A goose on the towpath")).toBeVisible();
  await expect(page.getByText("Sentence number 40 of a very long story about the shed.")).toBeVisible();

  // Voice notes become a card (audio cannot print); no player is left behind.
  await expect(page.getByText("Voice note, 0:04. Listen on the web round.")).toBeVisible();
  await expect(page.locator(".print-sheet main").locator("audio, button, textarea, input")).toHaveCount(0);

  // Polls: each pick by name, and the tally as words and numbers, not only a bar.
  const poll = page.locator("section").filter({ hasText: PPOLL });
  await expect(poll.getByText("Results · 2 votes")).toBeVisible();
  const tally = poll.getByRole("list", { name: "Results" });
  await expect(tally.locator("li").nth(0)).toContainText("June");
  await expect(tally.locator("li").nth(2)).toContainText("August");
  await expect(poll.getByRole("list", { name: "Chose June, August" })).toBeVisible();
  await expect(poll.getByRole("list", { name: "Chose August" })).toBeVisible();

  // Sections: a standard answer, a captioned photo wall, a music card as text, events untouched.
  await expect(page.getByRole("heading", { level: 2, name: /Highlights/ })).toBeVisible();
  await expect(page.getByText("Marshmallows, obviously")).toBeVisible();
  await expect(page.getByText("The bridge at night")).toBeVisible();
  const music = page.locator(".print-card").filter({ hasText: "Rain Song — The Keepsakes" });
  await expect(music).toContainText(/spotify/i);
  await expect(music).toContainText("https://open.spotify.com/track/keepsake");
  await expect(page.getByRole("heading", { level: 2, name: "Nobody wrote here" })).toHaveCount(0);

  // Reactions are summarised in words; comments sit where they belong.
  await expect(page.getByText("Reactions: ❤️ 2")).toBeVisible();
  const goose = page.locator(".print-answer").filter({ hasText: "A goose on the towpath" });
  await expect(goose.getByRole("group", { name: "Comments on this answer" })).toContainText("Best goose ever");
  await expect(goose.getByRole("group", { name: "Comments on this answer" })).toContainText("@Alice");
  const thread = page.getByRole("heading", { level: 2, name: "Comments" }).locator("xpath=..");
  await expect(thread).toContainText("What a round!");
  await expect(thread).toContainText("Agreed!");
  await expect(thread).toContainText("Sam wrote");
  await expect(thread).not.toContainText("Best goose ever");

  // Admin-only sections stay where the web round keeps them: only for people who can see them.
  await expect(page.getByText("Budget stays secret.")).toHaveCount(0);

  // What the browser would save: a real multi-page PDF from the print stylesheet alone.
  const pdf = await page.pdf({ format: "A4", printBackground: false });
  const pages = pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? [];
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  expect(pages.length).toBeGreaterThanOrEqual(5);
});

test("Q1 · an owner's print view keeps the owners-only section, and a loop's own paper prints light", async ({ page }) => {
  const world = await seedKeepsake();
  await rows("update groups set theme_preset = 'bluebell' where id = $1", [world.loop.groupId]);

  await openPrintView(page, `/i/${world.issueId}?print&m=${world.sam.token}`, "dark");
  await expect(page.getByText("Budget stays secret.")).toBeVisible();

  // The preset's light ink and accent, on white: the screen's dark paper never gets through.
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.querySelector(".print-sheet")!);
    return { page: style.getPropertyValue("--page").trim(), accent: style.getPropertyValue("--accent").trim(), ink: style.getPropertyValue("--ink").trim() };
  });
  expect(tokens.page).toBe("#ffffff");
  expect(tokens.accent.toLowerCase()).toBe("#2f5fb5");
  expect(tokens.ink.toLowerCase()).toBe("#22304a");
});

test("Q1 · a round that has not gone out has no print action, and ?print changes nothing about it", async ({ page }) => {
  const world = await seedKeepsake();
  const open = await seedOpenIssue(world.loop, { openedAt: new Date("2026-11-06T08:00:00Z") });

  await page.goto(`/i/${open.issueId}?m=${world.alice.token}`);
  await expect(page.getByRole("link", { name: "Print this round" })).toHaveCount(0);

  await page.goto(`/i/${open.issueId}?print&m=${world.alice.token}`);
  await expect(page.locator(".print-sheet")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("Q1 · a shared round prints for people with only the link, and without anyone's comments", async ({ page }) => {
  const world = await seedKeepsake();

  await page.goto(`/s/${world.shareToken}`);
  await page.getByRole("link", { name: "Print this round" }).click();
  await expect(page).toHaveURL(`/s/${world.shareToken}?print`);
  await expect(page.getByRole("link", { name: "Back to the round" })).toHaveAttribute("href", `/s/${world.shareToken}`);
  await expect(page.getByRole("heading", { level: 3, name: "Alice" }).first()).toBeVisible();
  await expect(page.getByText("A goose on the towpath")).toBeVisible();
  await expect(page.getByText("What a round!")).toHaveCount(0);
  await expect(page.getByText("Budget stays secret.")).toHaveCount(0);

  // Turning sharing off ends the paper too.
  await rows("update groups set share_enabled = false where id = $1", [world.loop.groupId]);
  await page.goto(`/s/${world.shareToken}?print`);
  await expect(page.getByRole("heading", { name: "This page isn't here" })).toBeVisible();
  await expect(page.getByText("A goose on the towpath")).toHaveCount(0);
});

test("Q1 · the print view passes WCAG AA in both colour schemes", async ({ page }) => {
  const world = await seedKeepsake();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await page.goto(`/i/${world.issueId}?print&m=${world.alice.token}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(result.violations.map((violation) => `${violation.id} ${violation.nodes.map((n) => n.target).join(" ")}`), scheme).toEqual([]);
  }
});

test("Q1 · an empty or tiny round still prints cleanly", async ({ page }) => {
  const world = await seedKeepsake();
  const small = await seedDeliveredIssue(world.loop, {
    deliveredAt: new Date("2026-11-06T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Just me." }],
  });
  await page.goto(`/i/${small.issueId}?print`);
  await expect(page.getByRole("heading", { level: 1, name: "Round 2" })).toBeVisible();
  await expect(page.getByText("Just me.")).toBeVisible();
  await expect(page.getByText("1 answer from the group.")).toBeVisible();
  await expect(page.locator(".print-question")).toHaveCount(1);
});

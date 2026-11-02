import { expect, type Locator, type Page } from "@playwright/test";

/** The value of a CSS custom property as the browser resolved it on <html>. */
export async function cssVar(page: Page, name: string): Promise<string> {
  return page.evaluate((variable) => getComputedStyle(document.documentElement).getPropertyValue(variable).trim(), name);
}

/**
 * Visit a path with the browser asking for light or dark, and wait until the app agrees.
 * Motion is reduced too: the cards fade in over 320ms, and a contrast audit that lands
 * mid-fade measures a blend of two colours that never appears on a settled page.
 */
export async function gotoScheme(page: Page, path: string, scheme: "light" | "dark"): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
  await page.goto(path);
  await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
}

/** The distinct paper of each curated preset: light page, then dark page. */
export const PAPER = {
  gingham: { light: "#fff3f5", dark: "#241a20" },
  bluebell: { light: "#eef3fb", dark: "#18202c" },
  meadow: { light: "#f0f6ec", dark: "#18211b" },
  marmalade: { light: "#fff3e0", dark: "#231b12" },
  lilac: { light: "#f5f0fb", dark: "#1e1826" },
} as const;

import { rows } from "./db";
import { E2E_NOW } from "./clock";
import { seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies } from "./seed";

/**
 * A loop with a delivered round to read (and share), and an open round that
 * Alice has answered, so the next delivery sweep has something to send.
 */
export async function seedWorld(shareToken = "world-share-token") {
  const loop = await seedLoop();
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    shareToken,
    answers: [{ email: "alice@friendloop.test", body: "Alice found a very patient goose." }],
  });
  const open = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:05:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: open.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "The cat." }],
    submittedAt: new Date("2026-01-02T08:05:00Z"),
  });
  return { loop, delivered, open, alice, shareToken };
}

/**
 * An uncontrolled file input has no visible sign of life, and a file chosen
 * before React attaches its handler is silently dropped. React hangs its props on
 * the DOM node when it hydrates; wait for that.
 */
export async function chooseFile(
  page: Page,
  label: string,
  file: { name: string; mimeType: string; buffer: Buffer },
  within: Locator = page.locator("body"),
): Promise<void> {
  const input = within.getByLabel(label);
  await input.evaluate(
    (node) => new Promise<void>((resolve) => {
      const ready = () => Object.keys(node).some((key) => key.startsWith("__reactProps"));
      if (ready()) return resolve();
      const timer = setInterval(() => ready() && (clearInterval(timer), resolve()), 25);
    }),
  );
  await input.setInputFiles(file);
}

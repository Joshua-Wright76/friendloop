import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "./support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue } from "./support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "./support/harness";

/**
 * Accessibility on the device the product actually ships to.
 *
 * The in-depth audit runs on desktop and resizes itself for the picker; that is
 * thorough but it is not a phone. This one runs in the `phone` project — real
 * WebKit, real touch viewport — over the three surfaces a contributor sees
 * without an account: the reply sheet, a delivered round, and its share page.
 * No sign-in, because a WebKit session race would make this about Playwright
 * rather than about the page.
 */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

async function audit(page: import("@playwright/test").Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations,
    `${label}: ${result.violations.map((violation) => `${violation.id} (${violation.nodes.length})`).join(", ")}`,
  ).toEqual([]);
}

test("WCAG AA · the reply sheet on a phone, with the sheet open", async ({ page }) => {
  test.setTimeout(60_000);
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await audit(page, "/r (sheet)");

  // Typing opens the sticky action bar, which only exists at phone widths.
  await page.getByLabel("What made you laugh this week?").fill("A cat fist bump.");
  await expect(page.getByRole("button", { name: "Send answers" })).toBeVisible();
  await audit(page, "/r (typing)");

  // The confirmation that replaces the sheet once the answers are sent.
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByRole("heading", { name: "Sent!" })).toBeVisible();
  await audit(page, "/r (sent)");
});

test("WCAG AA · a delivered round and its share page on a phone", async ({ page }) => {
  test.setTimeout(60_000);
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "The cat fist bump." }],
    shareToken: "phone-a11y-share-token",
  });
  // Share links only resolve while the loop has sharing switched on.
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);

  await page.goto(`/s/phone-a11y-share-token`);
  await expect(page.getByText("The cat fist bump.")).toBeVisible();
  await audit(page, "/s (share)");

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await audit(page, "/i (phone)");
});

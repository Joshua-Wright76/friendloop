import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { resetDatabase } from "./support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue } from "./support/seed";
import { signIn } from "./support/harness";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, path: string, navigate = true) {
  if (navigate) await page.goto(path);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(
    result.violations,
    `${path}: ${result.violations.map((violation) => `${violation.id} (${violation.nodes.length})`).join(", ")}`,
  ).toEqual([]);
}

async function auditThemes(page: Page, paths: string[]) {
  for (const theme of ["light", "dark"] as const) {
    for (const path of paths) {
      await page.goto(path);
      if (await page.locator("html").getAttribute("data-theme") !== theme) {
        await page.getByRole("button", { name: theme === "light" ? /switch to light mode/ : /switch to dark mode/ }).click();
      }
      await audit(page, path);
    }
  }
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("WCAG AA · public and authentication pages", async ({ page }) => {
  test.setTimeout(90_000);
  await auditThemes(page, ["/", "/signin", "/signin/check-email", "/signin/confirm?problem=unknown", "/r/invalid"]);
});

test("WCAG AA · loop management, creation, and reply pages", async ({ page }) => {
  test.setTimeout(120_000);
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-10-23T07:00:00Z") });
  await signIn(page, "owner@friendloop.test");

  await auditThemes(page, [
    "/you",
    "/g/new",
    `/g/${loop.groupId}`,
    `/g/${loop.groupId}/members`,
    `/g/${loop.groupId}/questions`,
    `/g/${loop.groupId}/issues`,
    `/g/${loop.groupId}/settings`,
    `/r/${loop.ownerToken}`,
  ]);

  await page.goto("/g/new");
  await page.getByRole("button", { name: /^Timezone:/ }).click();
  await audit(page, "/g/new?picker=open", false);

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /^Timezone:/ }).click();
  const pickerSheet = page.getByRole("dialog", { name: "Timezone" });
  await expect(pickerSheet).toBeVisible();
  await audit(page, "/g/new?picker=phone", false);
  const timezoneTrigger = page.getByRole("button", { name: /^Timezone:/ });
  const closePicker = pickerSheet.getByRole("button", { name: "Close" });
  const activeOption = pickerSheet.locator('[role="option"][aria-selected="true"]');
  const searchBox = pickerSheet.getByRole("textbox", { name: "Search timezones…" });

  // The sheet contains keyboard focus in both directions, including when the
  // active option is the last focusable control.
  await expect(searchBox).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(closePicker).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(activeOption).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(closePicker).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  await timezoneTrigger.click();
  await expect(pickerSheet).toBeVisible();
  await closePicker.click();
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  await timezoneTrigger.click();
  await expect(pickerSheet).toBeVisible();
  await searchBox.fill("Tokyo");
  await pickerSheet.getByRole("option", { name: "Asia/Tokyo" }).click();
  await expect(page.locator('input[name="timezone"]')).toHaveValue("Asia/Tokyo");
  await expect(page.getByRole("button", { name: "Timezone: Asia/Tokyo" })).toBeVisible();
  await expect(pickerSheet).toBeHidden();
  await expect(timezoneTrigger).toBeFocused();

  // Updating a member role must preserve the trigger node and keyboard focus.
  await page.goto(`/g/${loop.groupId}/members`);
  const roleTrigger = page.getByRole("button", { name: /^Member type for .+:/ }).first();
  await roleTrigger.click();
  await page.getByRole("option", { name: "Admin" }).first().click();
  await expect(roleTrigger).toBeFocused();
});

test("WCAG AA · delivered and shared issues", async ({ page }) => {
  test.setTimeout(90_000);
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "The cat fist bump." }],
    shareToken: "a11y-share-token",
  });
  await db.update(groups).set({ shareEnabled: true }).where(eq(groups.id, loop.groupId));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await auditThemes(page, [`/i/${issue.issueId}?m=${alice.token}`, "/s/a11y-share-token"]);
});

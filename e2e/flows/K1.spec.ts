import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K1 · the owner shapes the section list over time", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByLabel("Emoji").fill("🍲");
  await page.getByLabel("Kind").selectOption({ label: "Standard — text and a photo" });
  await page.getByRole("button", { name: "Add section" }).click();

  await expect(page.getByText("Section added.")).toBeVisible();
  await expect(page.getByText("The potluck corner").first()).toBeVisible();

  // A second one moves above the first.
  await page.getByPlaceholder("The potluck corner").fill("Music picks");
  await page.getByLabel("Kind").selectOption({ label: "Music — Spotify, Bandcamp, or Qobuz picks" });
  await page.getByRole("button", { name: "Add section" }).click();
  await page.getByRole("button", { name: "Move section up" }).last().click();
  await expect(page.getByText("Section order updated.")).toBeVisible();
  const sectionList = page.getByLabel("Sections in order").locator("li");
  const first = sectionList.first();
  await expect(first).toContainText("Music picks");

  // Editing through the details form sticks.
  await page.getByRole("button", { name: "Move section up" }).nth(1).click();
  await expect(sectionList.first()).toContainText("The potluck corner");
  // Name the row by its title, not its position: the list reorders under us.
  const item = sectionList.filter({ hasText: "The potluck corner" });
  await item.getByText("Edit").click();
  await item.getByLabel("Title").fill("The potluck corner, revisited");
  await item.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByText("Section updated.")).toBeVisible();
  await expect(page.getByText("The potluck corner, revisited").first()).toBeVisible();

  // Archiving takes it out of the running list.
  await item.getByRole("button", { name: "Archive" }).click();
  await expect(page.getByText("Section archived.")).toBeVisible();
  await expect(page.getByText("The potluck corner, revisited")).toHaveCount(0);
});

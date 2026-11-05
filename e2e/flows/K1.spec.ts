import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, openRowMenu, pickOption, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K1 · the owner shapes the section list over time", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByLabel("Emoji").fill("🍲");
  await pickOption(page, "Kind", "Standard, with text and a photo");
  await page.getByRole("button", { name: "Add section" }).click();

  await expect(page.getByText("Section added.")).toBeVisible();
  await expect(page.getByText("The potluck corner").first()).toBeVisible();

  // A second one moves above the first.
  await page.getByPlaceholder("The potluck corner").fill("Music picks");
  await pickOption(page, "Kind", "Music, with Spotify, Bandcamp, or Qobuz picks");
  await page.getByRole("button", { name: "Add section" }).click();
  const sectionList = page.getByLabel("Sections in order").locator("> li");
  const music = sectionList.filter({ hasText: "Music picks" });
  await openRowMenu(page, "More for: Music picks");
  await music.getByRole("button", { name: "Move section up" }).click();
  await expect(page.getByText("Section order updated.")).toBeVisible();
  const first = sectionList.first();
  await expect(first).toContainText("Music picks");

  // Editing through the details form sticks.
  // Name the row by its title, not its position: the list reorders under us.
  const item = sectionList.filter({ hasText: "The potluck corner" });
  await openRowMenu(page, "More for: The potluck corner");
  await item.getByRole("button", { name: "Move section up" }).click();
  await expect(sectionList.first()).toContainText("The potluck corner");
  // The move came back through the server, which folds the menu away again.
  await openRowMenu(page, "More for: The potluck corner");
  await item.getByText("Edit").click();
  await item.getByLabel("Title").fill("The potluck corner, revisited");
  await item.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByText("Section updated.")).toBeVisible();
  await expect(page.getByText("The potluck corner, revisited").first()).toBeVisible();

  // Archiving takes it out of the running list.
  await openRowMenu(page, "More for: The potluck corner, revisited");
  await item.getByRole("button", { name: "Archive" }).click();
  await item.getByRole("button", { name: /^Yes, archive/ }).click(); // archiving asks first
  await expect(page.getByText("Section archived.")).toBeVisible();
  await expect(page.getByText("The potluck corner, revisited")).toHaveCount(0);
});

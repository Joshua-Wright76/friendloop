import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedAlbum } from "../support/album";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("P1 · a member opens the Album: delivered photos and voice notes, newest round first, a fullscreen viewer, and a way back to the answer", async ({ page }) => {
  const world = await seedAlbum();
  await signIn(page, "owner@friendloop.test");

  // The Album is a tab of the loop.
  await page.goto(`/g/${world.loop.groupId}`);
  await page.getByRole("navigation", { name: "Manage the loop" }).getByRole("link", { name: "Album" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${world.loop.groupId}/album$`));
  await expect(page.getByRole("heading", { level: 1, name: "Album" })).toBeVisible();

  // Grouped by round, newest first; a named round carries its name.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Camping weekend", "Round 1"]);
  await expect(page.getByText("8 photos and voice notes")).toBeVisible();

  // Voice notes play in the gallery; photos open in the viewer.
  await expect(page.getByLabel(/^Voice note from Bob, 0:04$/)).toBeVisible();
  await expect(page.getByLabel(/^Voice note from Alice, 0:04$/)).toBeVisible();

  // Nothing from the open round, a draft, or anywhere else.
  await expect(page.getByText("Surprise party plans")).toHaveCount(0);
  await expect(page.getByText("Never submitted")).toHaveCount(0);

  // The viewer: modal, counted, arrow keys and buttons, Escape, focus returns.
  const tile = page.getByRole("button", { name: "Open photo from Bob: Tent at dawn" });
  await tile.click();
  const viewer = page.getByRole("dialog", { name: "Photo viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("Photo 1 of 6")).toBeVisible();
  await expect(viewer.getByText("Tent at dawn")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Previous photo/ })).toBeDisabled();

  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("Photo 2 of 6")).toBeVisible();
  await expect(viewer.getByText("The lake swim")).toBeVisible();
  await viewer.getByRole("button", { name: /Next photo/ }).click();
  await expect(viewer.getByText("Photo 3 of 6")).toBeVisible();
  await expect(viewer.getByText("Marshmallows, obviously")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText("Photo 2 of 6")).toBeVisible();

  // Tab stays inside the modal.
  for (let step = 0; step < 6; step += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(tile).toBeFocused();

  // "View in the round" lands on that very answer.
  await tile.click();
  await page.getByRole("dialog", { name: "Photo viewer" }).getByRole("link", { name: "View in the round" }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${world.round2}#answer-`));
  const hash = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`[id="${hash}"]`)).toContainText("Tent at dawn");
  await expect(page.locator(`[id="${hash}"]`)).toBeInViewport();
});

test("P1 · a member who reads from the inbox opens the same Album with their link, and never sees what is admin-only", async ({ page }) => {
  const world = await seedAlbum();

  // The delivered round links to it, and the link keeps them recognised.
  await page.goto(`/i/${world.round2}?m=${world.alice.token}`);
  await page.getByRole("link", { name: "See the album" }).click();
  await expect(page).toHaveURL(new RegExp(`/album/${world.loop.groupId}\\?m=${world.alice.token}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Album" })).toBeVisible();
  await expect(page.getByText("7 photos and voice notes")).toBeVisible();
  await expect(page.getByText("Budget receipt")).toHaveCount(0);
  await expect(page.locator(".album-grid").getByText(/You$/).first()).toBeVisible();

  // Their "view in the round" link carries the token too.
  const link = page.getByRole("link", { name: "View in the round" }).first();
  await expect(link).toHaveAttribute("href", new RegExp(`/i/${world.round2}\\?m=${world.alice.token}#`));
});

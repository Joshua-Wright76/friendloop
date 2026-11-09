import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedAlbum } from "../support/album";
import { signIn } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("P1 · a member opens the Album: delivered photos and voice notes, newest round first, a fullscreen viewer, and a way back to the answer", async ({ page }) => {
  const world = await seedAlbum();
  await signIn(page, "owner@friendloop.test");

  // The Album is a tab of the loop.
  await page.goto(`/g/${world.loop.groupId}`);
  await page.getByRole("navigation", { name: copy.common.navigation.ariaLabel }).getByRole("link", { name: copy.album.linkLabel }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${world.loop.groupId}/album$`));
  await expect(page.getByRole("heading", { level: 1, name: copy.album.title })).toBeVisible();

  // Grouped by round, newest first; a named round carries its name.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Camping weekend", text(copy.album.round, { number: 1 })]);
  await expect(page.getByText(text(copy.album.countAll, { total: "8" }))).toBeVisible();

  // Voice notes play in the gallery; photos open in the viewer.
  await expect(page.getByTitle(copyPattern(copy.album.voiceFrom, { values: { author: "Bob", duration: "0:04" }, start: true, end: true }))).toBeVisible();
  await expect(page.getByTitle(copyPattern(copy.album.voiceFrom, { values: { author: "Alice", duration: "0:04" }, start: true, end: true }))).toBeVisible();

  // Nothing from the open round, a draft, or anywhere else.
  await expect(page.getByText("Surprise party plans")).toHaveCount(0);
  await expect(page.getByText("Never submitted")).toHaveCount(0);

  // The viewer: modal, counted, arrow keys and buttons, Escape, focus returns.
  const tile = page.getByRole("button", { name: text(copy.album.openPhoto, { author: "Bob", about: "Tent at dawn" }) });
  await tile.click();
  const viewer = page.getByRole("dialog", { name: copy.album.viewer.label });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText(text(copy.album.viewer.position, { current: "1", total: "6" }))).toBeVisible();
  await expect(viewer.getByText("Tent at dawn")).toBeVisible();
  await expect(viewer.getByRole("button", { name: copyPattern(copy.album.viewer.previous) })).toBeDisabled();

  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText(text(copy.album.viewer.position, { current: "2", total: "6" }))).toBeVisible();
  await expect(viewer.getByText("The lake swim")).toBeVisible();
  await viewer.getByRole("button", { name: copyPattern(copy.album.viewer.next) }).click();
  await expect(viewer.getByText(text(copy.album.viewer.position, { current: "3", total: "6" }))).toBeVisible();
  await expect(viewer.getByText("Marshmallows, obviously")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByText(text(copy.album.viewer.position, { current: "2", total: "6" }))).toBeVisible();

  // Tab stays inside the modal.
  for (let step = 0; step < 6; step += 1) await page.keyboard.press("Tab");
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest("dialog")))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(tile).toBeFocused();

  // "View in the round" lands on that very answer.
  await tile.click();
  await page.getByRole("dialog", { name: copy.album.viewer.label }).getByRole("link", { name: copy.album.viewInIssue }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${world.round2}#answer-`));
  const hash = new URL(page.url()).hash.slice(1);
  await expect(page.locator(`[id="${hash}"]`)).toContainText("Tent at dawn");
  await expect(page.locator(`[id="${hash}"]`)).toBeInViewport();
});

test("P1 · a member who reads from the inbox opens the same Album with their link, and never sees what is admin-only", async ({ page }) => {
  const world = await seedAlbum();

  // The delivered round links to it, and the link keeps them recognised.
  await page.goto(`/i/${world.round2}?m=${world.alice.token}`);
  await page.getByRole("link", { name: copy.album.issueLink }).click();
  await expect(page).toHaveURL(new RegExp(`/album/${world.loop.groupId}\\?m=${world.alice.token}$`));
  await expect(page.getByRole("heading", { level: 1, name: copy.album.title })).toBeVisible();
  await expect(page.getByText(text(copy.album.countAll, { total: "7" }))).toBeVisible();
  await expect(page.getByText("Budget receipt")).toHaveCount(0);
  await expect(page.locator(".album-grid").getByText(/You$/).first()).toBeVisible();

  // Their "view in the round" link carries the token too.
  const link = page.getByRole("link", { name: copy.album.viewInIssue }).first();
  await expect(link).toHaveAttribute("href", new RegExp(`/i/${world.round2}\\?m=${world.alice.token}#`));
});

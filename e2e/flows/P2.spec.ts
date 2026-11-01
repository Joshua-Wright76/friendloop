import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedAlbum } from "../support/album";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("P2 · filtering to one person and searching a word both narrow the Album, and an empty result says so", async ({ page }) => {
  const world = await seedAlbum();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/album`);
  const gallery = page.getByRole("heading", { level: 2 });
  await expect(gallery).toHaveCount(2);

  // One person across the rounds.
  await page.locator('select[name="member"]').selectOption({ label: "Bob" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(new RegExp(`member=${world.bob.id}`));
  await expect(page.getByText("2 photos and voice notes")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Open photo from Bob: Tent at dawn$/ })).toBeVisible();
  await expect(page.getByLabel(/^Voice note from Bob/)).toBeVisible();
  await expect(page.getByText("The lake swim")).toHaveCount(0);

  // A word, matched in the answer, a caption or the question.
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/album$/);
  await page.locator('input[name="q"]').fill("MARSHMALLOWS");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByText("1 photo or voice note")).toBeVisible();
  await expect(page.getByRole("button", { name: /Marshmallows, obviously/ })).toBeVisible();
  await expect(page.locator('input[name="q"]')).toHaveValue("MARSHMALLOWS");

  await page.locator('input[name="q"]').fill("looking forward");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByText("3 photos and voice notes")).toBeVisible();

  // Both at once.
  await page.locator('select[name="member"]').selectOption({ label: "Alice" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByText("2 photos and voice notes")).toBeVisible();

  // Nothing matching: plainly said, with a way out.
  await page.locator('input[name="q"]').fill("zebra");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("status")).toContainText("Nothing matches that.");
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page.getByText("8 photos and voice notes")).toBeVisible();

  // A hand-edited URL is no more than a missing filter.
  await page.goto(`/g/${world.loop.groupId}/album?member=nope&pages=-5&q=%25`);
  await expect(page.getByRole("status")).toContainText("Nothing matches that.");
});

test("P2 · a long album shows a page at a time and keeps its filters when it grows", async ({ page }) => {
  const world = await seedAlbum();
  const [{ id: replyId }] = await rows<{ id: string }>("select id from section_replies limit 1");
  await rows(
    `insert into section_media (section_reply_id, url, caption, position)
     select $1, u.url, 'Extra ' || n, 10 + n from (select url from section_media limit 1) u, generate_series(1, 30) n`,
    [replyId],
  );
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/album`);

  await expect(page.getByText("24 of 38")).toBeVisible();
  await expect(page.locator(".album-grid > li")).toHaveCount(24);
  await page.getByRole("link", { name: "Show more" }).click();
  await expect(page).toHaveURL(/pages=2$/);
  await expect(page.locator(".album-grid > li")).toHaveCount(38);
  await expect(page.getByText("38 photos and voice notes")).toBeVisible();
  await expect(page.getByRole("link", { name: "Show more" })).toHaveCount(0);

  // Filters ride along on the link.
  await page.goto(`/g/${world.loop.groupId}/album?q=extra`);
  await expect(page.getByText("24 of 30")).toBeVisible();
  await expect(page.getByRole("link", { name: "Show more" })).toHaveAttribute("href", /q=extra&pages=2/);
});

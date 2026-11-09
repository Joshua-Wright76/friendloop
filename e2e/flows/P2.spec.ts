import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedAlbum } from "../support/album";
import { pickOption, signIn, unfold } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("P2 · filtering to one person and searching a word both narrow the Album, and an empty result says so", async ({ page }) => {
  const world = await seedAlbum();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/album`);
  const gallery = page.getByRole("heading", { level: 2 });
  await expect(gallery).toHaveCount(2);

  // One person across the rounds. Choosing them applies the filter.
  await unfold(page, copy.album.filterSummary);
  await pickOption(page, copy.album.memberLabel, "Bob");
  await expect(page).toHaveURL(new RegExp(`member=${world.bob.id}`));
  await expect(page.getByText(text(copy.album.countAll, { total: "2" }))).toBeVisible();
  await expect(page.getByRole("button", { name: copyPattern(copy.album.openPhoto, { values: { author: "Bob", about: "Tent at dawn" }, start: true, end: true }) })).toBeVisible();
  await expect(page.getByTitle(copyPattern(copy.album.voiceFrom, { values: { author: "Bob" }, start: true }))).toBeVisible();
  await expect(page.getByText("The lake swim")).toHaveCount(0);

  // A word, matched in the answer, a caption or the question.
  await page.getByRole("link", { name: copy.album.clear }).click();
  await expect(page).toHaveURL(/\/album$/);
  await unfold(page, copy.album.filterSummary);
  await page.locator('input[name="q"]').fill("MARSHMALLOWS");
  await page.getByRole("button", { name: copy.album.apply }).click();
  await expect(page.getByText(copy.album.countOne)).toBeVisible();
  await expect(page.getByRole("button", { name: /Marshmallows, obviously/ })).toBeVisible();
  await expect(page.locator('input[name="q"]')).toHaveValue("MARSHMALLOWS");

  await page.locator('input[name="q"]').fill("looking forward");
  await page.getByRole("button", { name: copy.album.apply }).click();
  await expect(page.getByText(text(copy.album.countAll, { total: "3" }))).toBeVisible();

  // Both at once.
  await pickOption(page, copy.album.memberLabel, "Alice");
  await expect(page.getByText(text(copy.album.countAll, { total: "2" }))).toBeVisible();

  // Nothing matching: plainly said, with a way out.
  await page.locator('input[name="q"]').fill("zebra");
  await page.getByRole("button", { name: copy.album.apply }).click();
  await expect(page.getByRole("status").filter({ hasText: copy.album.emptyFiltered })).toBeVisible();
  await page.getByRole("link", { name: copy.album.clear }).click();
  await expect(page.getByText(text(copy.album.countAll, { total: "8" }))).toBeVisible();

  // A hand-edited URL is no more than a missing filter.
  await page.goto(`/g/${world.loop.groupId}/album?member=nope&pages=-5&q=%25`);
  await expect(page.getByRole("status").filter({ hasText: copy.album.emptyFiltered })).toBeVisible();
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
  await page.getByRole("link", { name: copy.album.showMore }).click();
  await expect(page).toHaveURL(/pages=2$/);
  await expect(page.locator(".album-grid > li")).toHaveCount(38);
  await expect(page.getByText(text(copy.album.countAll, { total: "38" }))).toBeVisible();
  await expect(page.getByRole("link", { name: copy.album.showMore })).toHaveCount(0);

  // Filters ride along on the link.
  await page.goto(`/g/${world.loop.groupId}/album?q=extra`);
  await expect(page.getByText("24 of 30")).toBeVisible();
  await expect(page.getByRole("link", { name: copy.album.showMore })).toHaveAttribute("href", /q=extra&pages=2/);
});

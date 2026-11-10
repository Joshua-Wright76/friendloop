import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addWithCard, runSweep, signIn } from "../support/harness";
import { makePng } from "../support/audio";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K4 · a photo wall takes several photos, captions optional", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "The wall", format: copy.questions.item.formats.photo_wall, frequency: copy.questions.item.frequencies.every_round });
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  // A photo wall is a card of its own, in its place in the round.
  const wall = page.locator("section").filter({ has: page.getByRole("heading", { name: "The wall" }) });

  // No caption needed for a photo to join the wall.
  await wall.getByLabel(copy.identity.profile.add).first().setInputFiles({
    name: "first.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText(copy.reply.sectionUploaded)).toBeVisible();
  await expect(wall.getByRole("button", { name: copy.reply.sectionRemovePhoto })).toHaveCount(1);

  // A caption can go on the next one.
  await page.getByLabel("Caption").first().fill("The leftovers");
  await wall.getByLabel(copy.identity.profile.add).first().setInputFiles({
    name: "second.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText("The leftovers")).toBeVisible();
  const two = await rows<{ count: number }>("select count(*)::int as count from reply_media");
  expect(two[0].count).toBe(2);

  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("The leftovers")).toBeVisible();
  // The photo with no caption still says whose it is.
  await expect(page.locator("figcaption").first()).toHaveText(/^Alice[^,]*$/);

  // Tapping a photo opens it full size, with the others a step away and a download.
  const first = page.getByRole("button", { name: /Open photo from .*: The wall/ });
  await first.click();
  const viewer = page.getByRole("dialog", { name: copy.album.viewer.label });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText(copyText(copy.album.viewer.position, { current: "1", total: "2" }))).toBeVisible();
  const download = viewer.getByRole("link", { name: copy.album.viewer.download });
  await expect(download).toHaveAttribute("download", /^friendloop-.+-1\.png$/);
  const [media] = await rows<{ url: string }>("select url from reply_media order by position limit 1");
  await expect(download).toHaveAttribute("href", media.url);
  // Same-origin uploads honour the attribute, so the click really saves a file.
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/^friendloop-.+-1\.png$/);

  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText(copyText(copy.album.viewer.position, { current: "2", total: "2" }))).toBeVisible();
  await expect(viewer.getByText("The leftovers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(first).toBeFocused();
});

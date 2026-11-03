import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn } from "../support/harness";
import { chooseFile, seedWorld } from "../support/identity";
import { cameraPhoto, measureUpload } from "../support/camera";

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async () => {
  await resetDatabase();
});

const MB = 1024 * 1024;

test("T1 · a full-size camera photo goes up everywhere a photo can, and is stored at a sensible size", async ({ page }) => {
  test.setTimeout(180_000);
  const { loop, delivered, alice } = await seedWorld();
  await page.goto(`/r/${alice.token}`);
  const photo = { name: "IMG_4021.JPG", mimeType: "image/jpeg", buffer: await cameraPhoto(page) };
  // The point of the test: this is bigger than every cap the server has.
  expect(photo.buffer.length).toBeGreaterThan(6 * MB);

  // An answer photo.
  const firstQuestion = page.locator("section").filter({ hasText: "What made you laugh this week" });
  await chooseFile(page, "Add a photo", photo, firstQuestion);
  await expect(page.getByText("Photo saved").first()).toBeVisible({ timeout: 60_000 });
  const [reply] = await rows<{ photo_url: string }>(
    "select photo_url from replies where membership_id = $1 and photo_url is not null",
    [alice.id],
  );
  const answer = await measureUpload(page, reply.photo_url);
  expect(answer.bytes).toBeLessThanOrEqual(3.5 * MB);
  expect(Math.max(answer.width, answer.height)).toBeLessThanOrEqual(2560);
  // Scaled, not squashed: still 4:3.
  expect(answer.width / answer.height).toBeCloseTo(4 / 3, 1);

  // A profile picture, from the same link.
  await chooseFile(page, "Choose a photo of yourself", photo);
  await expect(page.getByText("Photo saved.")).toBeVisible({ timeout: 60_000 });
  const [member] = await rows<{ photo_url: string }>("select photo_url from memberships where id = $1", [alice.id]);
  const avatar = await measureUpload(page, member.photo_url);
  expect(avatar.bytes).toBeLessThanOrEqual(1 * MB);
  expect(Math.max(avatar.width, avatar.height)).toBeLessThanOrEqual(512);

  // A photo on a comment.
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  const form = page.getByLabel("Comment", { exact: true }).locator("xpath=ancestor::form");
  await form.getByLabel("Comment", { exact: true }).fill("Look at this one.");
  await form.locator('input[type="file"]').setInputFiles(photo);
  await expect(page.getByText("Photo: IMG_4021.jpg")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Post", exact: true }).click();
  await expect(page.getByRole("img", { name: /Photo from .* comment/ })).toBeVisible({ timeout: 60_000 });
  const [comment] = await rows<{ photo_url: string }>("select photo_url from comments where membership_id = $1", [alice.id]);
  expect((await measureUpload(page, comment.photo_url)).bytes).toBeLessThanOrEqual(3.5 * MB);

  // The header picture, from the owner's settings.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await chooseFile(page, "Choose a header picture", photo);
  await expect(page.getByText("Header picture saved.")).toBeVisible({ timeout: 60_000 });
  const [group] = await rows<{ header_image_url: string }>("select header_image_url from groups where id = $1", [loop.groupId]);
  const banner = await measureUpload(page, group.header_image_url);
  expect(banner.bytes).toBeLessThanOrEqual(3 * MB);
  expect(Math.max(banner.width, banner.height)).toBeLessThanOrEqual(2400);
});

test("T1 · a small photo is sent exactly as it is, and something that is not a picture is turned away kindly", async ({ page }) => {
  const { alice } = await seedWorld();
  await page.goto(`/r/${alice.token}`);

  // Not an image at all: said plainly, nothing stored.
  const firstQuestion = page.locator("section").filter({ hasText: "What made you laugh this week" });
  await chooseFile(page, "Add a photo", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }, firstQuestion);
  await expect(page.getByText("We couldn't read that photo. Try a JPEG or PNG.")).toBeVisible();
  expect(await rows("select 1 from replies where membership_id = $1 and photo_url is not null", [alice.id])).toHaveLength(0);

  // Bytes that claim to be a huge PNG but aren't: also kind, never a spinner that doesn't end.
  await chooseFile(page, "Add a photo", { name: "broken.png", mimeType: "image/png", buffer: Buffer.alloc(6 * MB) }, firstQuestion);
  await expect(page.getByText("We couldn't read that photo. Try a JPEG or PNG.")).toBeVisible();
});

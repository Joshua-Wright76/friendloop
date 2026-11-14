import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../support/test";
import { copy, text } from "@/lib/copy";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addWithCard, runSweep, signIn } from "../support/harness";

const clip = (name: string) => readFileSync(path.join(process.cwd(), "e2e", "support", "video", name));

test.beforeEach(async () => {
  await resetDatabase();
});

test("W2 · a photo wall takes up to two videos among its photos, and the delivered wall plays them", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "The wall", format: "Photo wall" });
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  const wall = page.locator("section").filter({ has: page.getByRole("heading", { name: "The wall" }) });
  const addVideo = wall.getByLabel(text(copy.reply.sectionAddVideoTo, { section: "The wall" }));

  // A caption rides along, exactly as it does on a photo.
  await wall.getByLabel(copy.reply.sectionCaptionLabel).first().fill("The ferry");
  await addVideo.setInputFiles({ name: "ferry.webm", mimeType: "video/webm", buffer: clip("clip.webm") });
  await expect(wall.getByText(copy.reply.videoSaved)).toBeVisible({ timeout: 30_000 });
  await expect(wall.getByText("The ferry")).toBeVisible();
  await expect(wall.getByRole("button", { name: copy.reply.sectionRemoveVideo })).toHaveCount(1);

  await addVideo.setInputFiles({ name: "waves.mp4", mimeType: "video/mp4", buffer: clip("clip.mp4") });
  await expect(wall.getByRole("button", { name: copy.reply.sectionRemoveVideo })).toHaveCount(2, { timeout: 30_000 });
  // Two is the most a wall takes from one person, so the button goes; photos can still join.
  await expect(addVideo).toHaveCount(0);
  await expect(wall.getByLabel(text(copy.reply.sectionAddPhotoTo, { section: "The wall" }))).toHaveCount(1);

  const media = await rows<{ url: string; video_url: string | null; caption: string | null }>(
    "select url, video_url, caption from reply_media order by position",
  );
  expect(media).toHaveLength(2);
  expect(media.every((item) => item.video_url && item.url.endsWith(".jpg"))).toBe(true);
  expect(media[0].caption).toBe("The ferry");

  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  // Each clip plays where it sits on the wall, its still showing until then.
  await expect(page.locator("video")).toHaveCount(2);
  await expect(page.locator("video").first()).toHaveAttribute("poster", media[0].url);
  await expect(page.getByText(/The ferry/)).toBeVisible();
  // Clips don't open in the photo viewer: there is nothing to open.
  await expect(page.getByRole("button", { name: /Open photo from/ })).toHaveCount(0);
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../support/test";
import { copy, text } from "@/lib/copy";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";

const clip = (name: string) => readFileSync(path.join(process.cwd(), "e2e", "support", "video", name));

test.beforeEach(async () => {
  await resetDatabase();
});

test("W1 · a written answer takes a video, keeps it on the next visit, and lets it go", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  const card = page.locator("section").filter({ has: page.locator("textarea") }).first();
  await card.getByLabel(text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.addVideo, n: 1 })).setInputFiles({
    name: "clip.webm",
    mimeType: "video/webm",
    buffer: clip("clip.webm"),
  });

  await expect(card.getByText(copy.reply.videoSaved)).toBeVisible({ timeout: 30_000 });
  const player = card.locator("video");
  await expect(player).toHaveAttribute("poster", /\/uploads\/[a-f0-9]{64}\.jpg$/);
  await expect(player).toHaveAttribute("src", /\/uploads\/[a-f0-9]{64}\.(mp4|webm)$/);
  await expect(page.getByRole("button", { name: new RegExp(text(copy.reply.answered, { answered: 1, total: "\\d+" })) })).toBeVisible();

  const [reply] = await rows<{ video_url: string; video_poster_url: string; video_duration_ms: number }>(
    "select video_url, video_poster_url, video_duration_ms from replies where video_url is not null",
  );
  expect(reply.video_duration_ms).toBeGreaterThan(1500);
  expect(reply.video_duration_ms).toBeLessThan(2600);

  // The clip and its still are served back, the clip in byte ranges a player can seek through.
  const ranged = await page.request.get(reply.video_url, { headers: { Range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);
  expect((await page.request.get(reply.video_poster_url)).headers()["content-type"]).toBe("image/jpeg");

  // A video alone is an answer, and it is there on the next visit.
  await page.reload();
  await expect(card.locator("video")).toHaveAttribute("src", reply.video_url);

  await card.getByRole("button", { name: text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.removeVideo, n: 1 }) }).click();
  await expect(card.getByText(copy.reply.videoRemoved)).toBeVisible();
  await expect(card.locator("video")).toHaveCount(0);
  const left = await rows("select id from replies where video_url is not null");
  expect(left).toHaveLength(0);
});

test("W1 · a file that isn't a video is refused in plain words, and nothing is saved", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  const card = page.locator("section").filter({ has: page.locator("textarea") }).first();
  await card.getByLabel(text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.addVideo, n: 1 })).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a video at all"),
  });
  await expect(card.getByText(copy.reply.errors.videoUnreadable)).toBeVisible({ timeout: 30_000 });
  const saved = await rows("select id from replies where video_url is not null");
  expect(saved).toHaveLength(0);
});

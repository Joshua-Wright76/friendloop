import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { makeMp3 } from "../support/audio";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J4 · without a recorder, the file picker answers", async ({ page }) => {
  // This browser has no MediaRecorder and no capture devices at all.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { get: () => undefined });
    Reflect.deleteProperty(window, "MediaRecorder");
  });

  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("This browser can't record here").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Record a voice note" })).toHaveCount(0);

  await page.getByLabel("Choose an audio file").first().setInputFiles({
    name: "voice-note.mp3",
    mimeType: "audio/mpeg",
    buffer: makeMp3(),
  });

  await expect(page.getByText("Voice note saved.").first()).toBeVisible();
  const [reply] = await rows<{ audio_url: string; audio_duration_ms: number }>(
    "select audio_url, audio_duration_ms from replies where audio_url is not null limit 1",
  );
  expect(reply.audio_url).toMatch(/\.mp3$/);
  expect(reply.audio_duration_ms).toBeGreaterThan(0);
});

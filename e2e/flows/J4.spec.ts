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

test("J4 · a page that isn't https says so, and a blocked or missing microphone is named, not blamed on the browser", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  // Plain http on a phone: no secure context, so no microphone API and no prompt.
  await page.addInitScript(() => {
    Object.defineProperty(window, "isSecureContext", { get: () => false });
    Object.defineProperty(navigator, "mediaDevices", { get: () => undefined });
  });
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("Recording only works on a secure (https) page").first()).toBeVisible();
  await expect(page.getByText("This browser can't record here")).toHaveCount(0);
  await expect(page.getByLabel("Choose an audio file").first()).toBeAttached();
});

test("J4 · a refused microphone permission and a missing microphone each get their own words", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.addInitScript(() => {
    (window as unknown as { __mic: string }).__mic = "NotAllowedError";
    Object.defineProperty(navigator, "mediaDevices", {
      get: () => ({
        getUserMedia: () => Promise.reject(new DOMException("no", (window as unknown as { __mic: string }).__mic)),
      }),
    });
  });
  await page.goto(`/r/${alice.token}`);
  const record = page.getByRole("button", { name: "Record a voice note" }).first();
  await record.click();
  await expect(page.getByText("This browser is blocking the microphone").first()).toBeVisible();

  await page.evaluate(() => { (window as unknown as { __mic: string }).__mic = "NotFoundError"; });
  await record.click();
  await expect(page.getByText("We couldn't find a microphone.").first()).toBeVisible();
});

import { test } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { expect, installFakeRecorder, recordOnFirstQuestion } from "../support/recorder";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J1 · a recorded voice note attaches and survives a reload", async ({ page }) => {
  await installFakeRecorder(page);
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await recordOnFirstQuestion(page);

  await expect(page.getByText("Voice note saved.").first()).toBeVisible();
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: /^Play voice note/ }).first()).toBeVisible();

  // The note rides the reply row: a fresh sheet load still has it.
  await page.reload();
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: /^Play voice note/ }).first()).toBeVisible();
  const [reply] = await rows<{ audio_url: string; audio_duration_ms: number }>(
    "select audio_url, audio_duration_ms from replies where audio_url is not null limit 1",
  );
  expect(reply.audio_url).toMatch(/\/uploads\/[a-f0-9]{64}\.(webm|m4a|ogg)$/);
  expect(reply.audio_duration_ms).toBeGreaterThan(0);
  expect(issue.deliversAt).toBeTruthy();
});

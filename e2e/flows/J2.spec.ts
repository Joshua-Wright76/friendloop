import { test } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { expect, installFakeRecorder, recordOnFirstQuestion } from "../support/recorder";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J2 · a voice note can be replaced, then removed", async ({ page }) => {
  await installFakeRecorder(page);
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await recordOnFirstQuestion(page);
  await expect(page.getByText(copy.reply.voiceSaved).first()).toBeVisible();
  const [first] = await rows<{ audio_url: string }>(
    "select audio_url from replies where audio_url is not null limit 1",
  );

  // Recording again replaces the take in place.
  await page.getByRole("button", { name: copy.reply.voiceReplace }).first().click();
  await expect(page.getByText(copyPattern(copy.reply.voiceRecording, { values: { elapsed: "0:0" } }))).toBeVisible();
  await page.getByRole("button", { name: copy.reply.voiceStop }).click();
  await expect(page.getByText(copy.reply.voiceSaved).first()).toBeVisible();
  const [second] = await rows<{ audio_url: string }>(
    "select audio_url from replies where audio_url is not null limit 1",
  );
  expect(second.audio_url).not.toBe(first.audio_url);

  // Removing clears the note and the row.
  await page.getByRole("button", { name: copy.reply.voiceRemove }).first().click();
  await expect(page.getByText(copy.reply.voiceRemoved).first()).toBeVisible();
  const after = await rows<{ count: number }>(
    "select count(*)::int as count from replies where audio_url is not null",
  );
  expect(after[0].count).toBe(0);
  await expect(page.locator("audio").first()).toHaveCount(0);
});

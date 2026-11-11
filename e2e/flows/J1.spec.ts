import { test } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { expect, installFakeRecorder, recordOnFirstQuestion } from "../support/recorder";
import { AFTER_FIRST_SLOT, clockHeaders, runSweep } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

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

  await expect(page.getByText(copy.reply.voiceSaved).first()).toBeVisible();
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: copyPattern(copy.voiceNote.playPlain, { start: true }) }).first()).toBeVisible();

  // The note rides the reply row: a fresh sheet load still has it.
  await page.reload();
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: copyPattern(copy.voiceNote.playPlain, { start: true }) }).first()).toBeVisible();
  const [reply] = await rows<{ audio_url: string; audio_duration_ms: number }>(
    "select audio_url, audio_duration_ms from replies where audio_url is not null limit 1",
  );
  expect(reply.audio_url).toMatch(/\/uploads\/[a-f0-9]{64}\.(webm|m4a|ogg)$/);
  expect(reply.audio_duration_ms).toBeGreaterThan(0);
  expect(issue.deliversAt).toBeTruthy();
});


test("J1 · a voice note on its own is an answer: it sends, and the round goes out", async ({ page }) => {
  await installFakeRecorder(page);
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));
  await page.goto(`/r/${alice.token}`);
  await recordOnFirstQuestion(page);
  await expect(page.getByText(copy.reply.voiceSaved).first()).toBeVisible();
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  const [reply] = await rows<{ audio_url: string | null }>("select audio_url from replies where issue_id = $1", [issue.issueId]);
  expect(reply.audio_url, "the voice note alone is an answer").not.toBeNull();

  const report = await runSweep(issue.deliversAt);
  expect(report.delivered).toBe(1);
  expect(report.skipped).toBe(0);
});

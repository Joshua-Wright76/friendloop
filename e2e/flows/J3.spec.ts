import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { makeWebm } from "../support/audio";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J3 · duration and size caps answer with the same warm error, never a 500", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions order by position limit 1",
  );

  // Four minutes of claimed recording time: over the hard stop.
  const tooLong = await page.request.post(`/api/reply/${alice.token}/audio`, {
    multipart: {
      issueQuestionId: question.id,
      audio: { name: "voice-note.webm", mimeType: "audio/webm", buffer: makeWebm() },
      durationMs: String(4 * 60 * 1000),
    },
  });
  expect(tooLong.status()).toBe(413);
  expect((await tooLong.json()).error).toContain("3 minutes");

  // Four megabytes of valid webm-shaped bytes: over the size cap.
  const tooLarge = await page.request.post(`/api/reply/${alice.token}/audio`, {
    multipart: {
      issueQuestionId: question.id,
      audio: { name: "voice-note.webm", mimeType: "audio/webm", buffer: makeWebm(5 * 1024 * 1024) },
      durationMs: String(1_000),
    },
  });
  expect(tooLarge.status()).toBe(413);
  expect((await tooLarge.json()).error).toContain("too big");

  // Nothing was stored, and the sheet stays clean.
  const after = await rows<{ count: number }>(
    "select count(*)::int as count from replies where audio_url is not null",
  );
  expect(after[0].count).toBe(0);

  await page.goto(`/r/${alice.token}`);
  await expect(page.locator("audio")).toHaveCount(0);
  await expect(page.getByText(copy.reply.voiceSaved)).toHaveCount(0);
});

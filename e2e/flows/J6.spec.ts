import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { runSweep } from "../support/harness";
import { enableShare, seedAudioReply } from "../support/audio";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J6 · voice notes are stored hashed and playable through a share link", async ({ page }) => {
  const loop = await seedLoop();
  const opened = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const audioUrl = await seedAudioReply({
    issueId: opened.issueId,
    membershipId: alice.id,
    questionText: "What made you laugh this week?",
    body: "The cat fist bump.",
  });

  // Same content-hash rule as photos: 64 hex characters before the extension.
  expect(audioUrl).toMatch(/^\/uploads\/[a-f0-9]{64}\.webm$/);

  await enableShare({ groupId: loop.groupId, issueId: opened.issueId, shareToken: "share-token-j6" });
  await runSweep(new Date(opened.deliversAt.getTime() + 60 * 1000));

  // A share-link visitor reads the same issue, voice notes included.
  await page.goto(`/s/share-token-j6`);
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: copyPattern(copy.voiceNote.playPlain, { start: true }) }).first()).toBeVisible();

  // The actual file answers under its hashed name (no data leaked in the URL).
  const response = await page.request.get(audioUrl);
  expect(response.status()).toBe(200);
  const [stored] = await rows<{ audio_url: string }>(
    "select audio_url from replies where audio_url is not null limit 1",
  );
  expect(stored.audio_url).toBe(audioUrl);
});

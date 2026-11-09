import { test, expect } from "@playwright/test";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { runSweep } from "../support/harness";
import { seedAudioReply } from "../support/audio";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("J5 · the web issue plays the note; the email points there instead", async ({ page }) => {
  const loop = await seedLoop();
  const opened = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedAudioReply({
    issueId: opened.issueId,
    membershipId: alice.id,
    questionText: "What made you laugh this week?",
    body: "The cat fist bump.",
  });

  await runSweep(new Date(opened.deliversAt.getTime() + 60 * 1000));

  await page.goto(`/i/${opened.issueId}?m=${alice.token}`);
  await expect(page.locator("audio").first()).toBeAttached();
  await expect(page.getByRole("button", { name: copyPattern(copy.voiceNote.playPlain, { start: true }) }).first()).toBeVisible();
  await expect(page.getByTitle(text(copy.issue.voiceLabel, { duration: "0:01" })).first()).toBeVisible();

  // The delivery email names the note and sends readers to the web issue.
  const email = await latestOutbox("delivery:");
  expect(email.html).toContain(copy.reply.voiceGroup);
  expect(email.html).not.toMatch(/<audio/i);
  expect(email.html).toMatch(copyPattern(copy.emails.voiceNoteListen));
});

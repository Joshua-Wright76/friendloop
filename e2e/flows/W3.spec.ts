import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "../support/test";
import { copy, text } from "@/lib/copy";
import { formatAudioDuration } from "@/lib/audio-validation";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { runSweep, signIn } from "../support/harness";

const clip = (name: string) => readFileSync(path.join(process.cwd(), "e2e", "support", "video", name));

test.beforeEach(async () => {
  await resetDatabase();
});

test("W3 · a delivered video plays on the round's page, and the email, print view and Album show its still", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  const card = page.locator("section").filter({ has: page.locator("textarea") }).first();
  await card.getByLabel(text(copy.a11yLabels.forQuestionNumber, { label: copy.reply.addVideo, n: 1 })).setInputFiles({
    name: "ferry.webm",
    mimeType: "video/webm",
    buffer: clip("clip.webm"),
  });
  await expect(card.getByText(copy.reply.videoSaved)).toBeVisible({ timeout: 30_000 });
  // Words after the clip: by then the page is live, so none of them are typed into
  // the server's HTML before the script that saves them arrives.
  await card.locator("textarea").fill("The ferry at dusk");
  await expect(card.getByText(copy.reply.questionStates.saved, { exact: true })).toBeVisible();
  const [reply] = await rows<{ video_url: string; video_poster_url: string; video_duration_ms: number }>(
    "select video_url, video_poster_url, video_duration_ms from replies where video_url is not null",
  );
  const label = text(copy.issue.videoLabel, { author: "Alice", duration: formatAudioDuration(reply.video_duration_ms) });

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");

  // The round's page: the browser's own player, the still until it plays, nothing downloaded before.
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await page.goto(`/i/${issue.id}?m=${bob.token}`);
  const player = page.getByLabel(label);
  await expect(player).toHaveAttribute("src", reply.video_url);
  await expect(player).toHaveAttribute("poster", reply.video_poster_url);
  await expect(player).toHaveAttribute("preload", "none");
  await expect(page.getByText("The ferry at dusk")).toBeVisible();

  // Email can't play video: the still links to the round, with the length and a way to watch.
  const email = await latestOutbox("delivery:");
  expect(email.html).toContain(`src="${reply.video_poster_url}"`);
  expect(email.html).toContain(text(copy.emails.videoNote, { duration: formatAudioDuration(reply.video_duration_ms) }));
  expect(email.html).toContain(copy.emails.videoNoteWatch);

  // Paper can't either: the still, and where to watch it.
  await page.goto(`/i/${issue.id}?print&m=${bob.token}`);
  await expect(page.locator(`img[src="${reply.video_poster_url}"]`)).toBeVisible();
  await expect(page.getByText(text(copy.print.videoCard, { duration: formatAudioDuration(reply.video_duration_ms) }))).toBeVisible();

  // The Album keeps it with the round's photos and voice notes, playable in place.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/album`);
  await expect(page.getByText(copy.album.countOne)).toBeVisible();
  const inAlbum = page.getByLabel(text(copy.album.videoFrom, { author: "Alice", duration: formatAudioDuration(reply.video_duration_ms) }));
  await expect(inAlbum).toHaveAttribute("src", reply.video_url);
  await expect(inAlbum).toHaveAttribute("poster", reply.video_poster_url);
});

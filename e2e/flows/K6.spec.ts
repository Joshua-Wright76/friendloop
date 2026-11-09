import { test, expect } from "@playwright/test";
import { db } from "@/db";
import { musicLinks } from "@/db/schema";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addWithCard, runSweep, signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K6 · a delivered issue renders a music card that opens the provider", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "Music picks", format: copy.questions.item.formats.music, frequency: copy.questions.item.frequencies.every_round });
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  const link = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";

  // The metadata cache is warm, so rendering never reaches the provider.
  await db
    .insert(musicLinks)
    .values({ url: link, provider: "spotify", title: "Our road trip record", artworkUrl: null, fetchedAt: new Date() });

  await page.getByPlaceholder(copy.reply.sectionMusicPlaceholder).fill(link);
  await page.getByLabel(copy.reply.sectionMusicCaptionLabel).first().fill("Our road trip record");
  await page.getByLabel(copy.reply.sectionMusicCaptionLabel).first().blur();
  await expect(page.getByText(copy.reply.nameSaved, { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);

  const card = page.getByRole("link", { name: /spotify/i }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", link);
});

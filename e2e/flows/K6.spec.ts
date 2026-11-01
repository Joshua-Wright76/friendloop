import { test, expect } from "@playwright/test";
import { db } from "@/db";
import { musicLinks } from "@/db/schema";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K6 · a delivered issue renders a music card that opens the provider", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("Music picks");
  await page.getByLabel("Kind").selectOption({ label: "Music — Spotify, Bandcamp, or Qobuz picks" });
  await page.getByRole("button", { name: "Add section" }).click();
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  const link = "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3";

  // The metadata cache is warm, so rendering never reaches the provider.
  await db
    .insert(musicLinks)
    .values({ url: link, provider: "spotify", title: "Our road trip record", artworkUrl: null, fetchedAt: new Date() });

  await page.getByPlaceholder("Paste a Spotify, Bandcamp, or Qobuz link").fill(link);
  await page.getByLabel("Caption").first().fill("Our road trip record");
  await page.getByRole("button", { name: "Save pick" }).click();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);

  const card = page.getByRole("link", { name: /spotify/i }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", link);
});

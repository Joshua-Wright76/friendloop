import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, pickOption, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K5 · a music link is validated warmly, then saved", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
  await page.getByPlaceholder("The potluck corner").fill("Music picks");
  await pickOption(page, "Kind", "Music, with Spotify, Bandcamp, or Qobuz picks");
  await page.getByRole("button", { name: "Add section" }).click();
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);

  // A non-music URL bounces with the plain-language error.
  await page.getByPlaceholder("Spotify, Bandcamp or Qobuz link").fill("https://example.com/album/123");
  // Leaving the field is the save.
  await page.getByPlaceholder("Spotify, Bandcamp or Qobuz link").blur();
  await expect(page.getByText("That link isn't a Spotify, Bandcamp, or Qobuz page.")).toBeVisible();

  // Nothing is stored while the link is invalid.
  const nothing = await rows<{ count: number }>(
    "select count(*)::int as count from section_replies where link_url is not null",
  );
  expect(nothing[0].count).toBe(0);

  // A real Spotify link saves quietly, then clears.
  await page.getByPlaceholder("Spotify, Bandcamp or Qobuz link").fill("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3");
  await page.getByLabel("A line about it").first().fill("Our road trip record");
  await page.getByLabel("A line about it").first().blur();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  const saved = await rows<{ link_url: string; link_provider: string }>(
    "select link_url, link_provider from section_replies where link_url is not null limit 1",
  );
  expect(saved[0].link_provider).toBe("spotify");
});

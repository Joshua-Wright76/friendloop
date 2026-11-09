import { test, expect } from "@playwright/test";
import { db } from "@/db";
import { musicLinks } from "@/db/schema";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, addWithCard, freezeClock, latestOutboxBody, runSweep, signIn, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K5 · a music link is validated warmly, then saved", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "Music picks", format: "Music link", frequency: "Every round" });
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
    "select count(*)::int as count from replies where link_url is not null",
  );
  expect(nothing[0].count).toBe(0);

  // A real Spotify link saves quietly, then clears.
  await page.getByPlaceholder("Spotify, Bandcamp or Qobuz link").fill("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3");
  await page.getByLabel("A line about it").first().fill("Our road trip record");
  await page.getByLabel("A line about it").first().blur();
  await expect(page.getByText("Saved.").first()).toBeVisible();

  const saved = await rows<{ link_url: string; link_provider: string }>(
    "select link_url, link_provider from replies where link_url is not null limit 1",
  );
  expect(saved[0].link_provider).toBe("spotify");
});

test("K5 · any written answer can carry a music link", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const playlist = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";
  // The metadata cache is warm, so rendering never reaches the provider.
  await db.insert(musicLinks).values({ url: playlist, provider: "spotify", title: "Kitchen dancing", artworkUrl: null, fetchedAt: new Date() });

  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("This, on repeat.");
  await expect(page.locator("[data-save-status]")).toHaveText("Saved. It goes out with the round.");

  // On a phone the attachments fold behind one button.
  const toggle = page.getByRole("button", { name: "Add a photo, sound or link" }).first();
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("button", { name: "Add a music link, question 1" }).click();
  const field = page.getByRole("textbox", { name: "Music link, question 1" });
  await expect(field).toBeFocused();

  // A link that isn't music is refused in plain words, and nothing is stored.
  await field.fill("https://example.com/song");
  await field.blur();
  await expect(page.getByText("That link isn't a Spotify, Bandcamp, or Qobuz page.")).toBeVisible();
  const nothing = await rows<{ count: number }>("select count(*)::int as count from replies where link_url is not null");
  expect(nothing[0].count).toBe(0);

  // A playlist saves beside the words, which it leaves alone.
  await field.fill(playlist);
  await field.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  const [saved] = await rows<{ body: string; link_url: string; link_provider: string }>(
    "select body, link_url, link_provider from replies where link_url is not null",
  );
  expect(saved).toEqual({ body: "This, on repeat.", link_url: playlist, link_provider: "spotify" });

  // It is still there on the next visit.
  await page.reload();
  await waitForSheet(page);
  await expect(page.getByRole("textbox", { name: "Music link, question 1" })).toHaveValue(playlist);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();

  // The round shows the answer with its music card, and the email carries the link.
  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("This, on repeat.")).toBeVisible();
  const card = page.getByRole("link", { name: /spotify/i }).first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", playlist);
  expect(await latestOutboxBody("delivery:")).toContain(playlist);
});

test("K5 · Remove link takes it off and keeps the words", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("Still funny.");
  const toggle = page.getByRole("button", { name: "Add a photo, sound or link" }).first();
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole("button", { name: "Add a music link, question 1" }).click();
  const field = page.getByRole("textbox", { name: "Music link, question 1" });
  await field.fill("https://someone.bandcamp.com/album/x");
  await field.blur();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Remove link, question 1" }).click();
  // The field goes, and the button that brings it back has focus.
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add a music link, question 1" })).toBeFocused();
  await expect.poll(async () =>
    (await rows<{ body: string; link_url: string | null }>("select body, link_url from replies"))[0],
  ).toEqual({ body: "Still funny.", link_url: null });
});

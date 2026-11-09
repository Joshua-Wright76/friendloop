import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { DELIVERY_DAY, openPart, runSweep, signIn } from "../support/harness";
import { PAPER, cssVar, gotoScheme, seedWorld } from "../support/identity";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("N2 · a loop that never chose a theme renders exactly as before, in both schemes and in email", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld("n2-share-token");

  await signIn(page, "owner@friendloop.test");
  for (const scheme of ["light", "dark"] as const) {
    for (const path of [
      `/g/${loop.groupId}`,
      `/r/${alice.token}`,
      `/i/${delivered.issueId}?m=${alice.token}`,
      "/s/n2-share-token",
    ]) {
      await gotoScheme(page, path, scheme);
      expect(await cssVar(page, "--page"), `${path} ${scheme}`).toBe(PAPER.gingham[scheme]);
      expect(await cssVar(page, "--accent"), `${path} ${scheme}`).toBe(scheme === "light" ? "#cc3456" : "#ff8ba4");
      // No stationery rule is injected at all: the stylesheet is the whole story.
      await expect(page.locator("style", { hasText: 'data-theme="light"]{' })).toHaveCount(0);
      await expect(page.locator(".snapshot img, img.loop-banner")).toHaveCount(0);
    }
  }

  await runSweep(DELIVERY_DAY);
  const mails = await rows<{ html: string }>("select html from outbox where kind in ('prompt', 'delivery')");
  expect(mails.length).toBeGreaterThan(0);
  for (const mail of mails) {
    expect(mail.html).toContain("#fff3f5");
    expect(mail.html).toContain("#cc3456");
    expect(mail.html).not.toContain("<img");
  }
});

test("N2 · choosing Gingham again stores nothing, so going back is the same as never leaving", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupPaper);

  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.bluebell.name) }).check();
  await expect(page.getByText(copy.stationery.statusSaved)).toBeVisible();
  await expect.poll(() => cssVar(page, "--page")).toBe(PAPER.bluebell.light);

  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.gingham.name) }).check();
  // The note from the first save may still be up, so wait on the paper itself.
  await expect.poll(() => cssVar(page, "--page")).toBe(PAPER.gingham.light);

  const [group] = await rows<{ theme_preset: string | null; theme_accent: string | null }>(
    "select theme_preset, theme_accent from groups where id = $1",
    [loop.groupId],
  );
  expect(group).toEqual({ theme_preset: null, theme_accent: null });
});

test("N2 · the sign-in surface never wears a loop's paper", async ({ page }) => {
  const loop = await seedLoop();
  await rows("update groups set theme_preset = 'lilac' where id = $1", [loop.groupId]);
  await page.goto("/signin");
  expect(await cssVar(page, "--page")).toBe(PAPER.gingham.light);
  await page.goto("/");
  expect(await cssVar(page, "--page")).toBe(PAPER.gingham.light);
});

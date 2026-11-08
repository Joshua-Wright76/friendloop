import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, openPart, runSweep, signIn } from "../support/harness";
import { cssVar, gotoScheme, seedWorld } from "../support/identity";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Choices = { theme_background: string | null; theme_paper_pack: string | null; theme_tape_pack: string | null; theme_mascot: string | null };

const choices = async (groupId: string): Promise<Choices> =>
  (await rows<Choices>("select theme_background, theme_paper_pack, theme_tape_pack, theme_mascot from groups where id = $1", [groupId]))[0];

async function expectAccessible(page: Page, label: string) {
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations, `${label}: ${result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
}

test("N6 · the owner picks a page, paper pack, tape pack and mascot separately, and each reaches every surface", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld("n6-share-token");
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, "Stationery");

  // The originals are chosen, and stored as nothing.
  for (const name of [/^Gingham$/, /^Plain cream/, /^Picnic$/, /^Cherries$/]) {
    await expect(page.getByRole("radio", { name })).toBeChecked();
  }
  await expect.poll(() => choices(loop.groupId)).toEqual({ theme_background: null, theme_paper_pack: null, theme_tape_pack: null, theme_mascot: null });

  // Each saves by itself and leaves the others alone: tape is not part of the paper.
  await page.getByRole("radio", { name: /^Hearts/ }).check();
  await expect.poll(() => choices(loop.groupId)).toEqual({ theme_background: "hearts", theme_paper_pack: null, theme_tape_pack: null, theme_mascot: null });
  await page.getByRole("radio", { name: /^Airmail/ }).check();
  await expect.poll(() => choices(loop.groupId)).toEqual({ theme_background: "hearts", theme_paper_pack: "airmail", theme_tape_pack: null, theme_mascot: null });
  await page.getByRole("radio", { name: /^Seaside/ }).check();
  await expect.poll(() => choices(loop.groupId)).toEqual({ theme_background: "hearts", theme_paper_pack: "airmail", theme_tape_pack: "seaside", theme_mascot: null });
  await page.getByRole("radio", { name: /^Frog/ }).check();
  await expect.poll(() => choices(loop.groupId)).toEqual({ theme_background: "hearts", theme_paper_pack: "airmail", theme_tape_pack: "seaside", theme_mascot: "frog" });
  await expect(page.getByTestId("mascot-preview").locator('img[src="/stickers/frog.svg"]')).toHaveCount(2);
  await expectAccessible(page, "settings");

  const surfaces = [
    `/g/${loop.groupId}`,
    `/r/${alice.token}`,
    `/i/${delivered.issueId}?m=${alice.token}`,
    "/s/n6-share-token",
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const path of surfaces) {
      await gotoScheme(page, path, scheme);
      expect(await cssVar(page, "--page-image"), `${path} ${scheme} page`).toContain("data:image/svg+xml");
      expect(await cssVar(page, "--paper-answer"), `${path} ${scheme} paper`).toContain("repeating-linear-gradient");
      expect(await cssVar(page, "--tape-dots"), `${path} ${scheme} tape`).not.toBe("");
      expect(await cssVar(page, "--mascot-image"), `${path} ${scheme} mascot`).toContain("/stickers/frog.svg");
      await expectAccessible(page, `${path} ${scheme}`);
    }
  }

  // The drawing really is what's on screen, in place of the cherries.
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`/i/${delivered.issueId}?m=${alice.token}`);
  const mark = page.locator(".mascot").first();
  expect(await mark.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("/stickers/frog.svg");
  expect(await mark.locator("svg").evaluate((el) => getComputedStyle(el).opacity)).toBe("0");
  const answerCard = page.locator('.card[data-paper="answer"]').first();
  expect(await answerCard.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain("repeating-linear-gradient");

  // The email carries the mascot as a picture it can show; the textures stay on the web.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' limit 1");
  expect(mail.html).toContain("/stickers/png/frog.png");
  expect(mail.html).not.toContain("🍒");

  // The picture exists at that address.
  const png = await page.request.get("/stickers/png/frog.png");
  expect(png.ok()).toBe(true);
  expect(png.headers()["content-type"]).toContain("image/png");
});

test("N6 · back to the originals stores nothing and adds no CSS, so the loop renders as it always did", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld();
  await rows("update groups set theme_background = 'stars', theme_paper_pack = 'journal', theme_tape_pack = 'kraft', theme_mascot = 'bee' where id = $1", [loop.groupId]);

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, "Stationery");
  await expect(page.getByRole("radio", { name: /^Stars/ })).toBeChecked();

  await page.getByRole("radio", { name: /^Gingham$/ }).check();
  await expect.poll(async () => (await choices(loop.groupId)).theme_background).toBeNull();
  await page.getByRole("radio", { name: /^Plain cream/ }).check();
  await expect.poll(async () => (await choices(loop.groupId)).theme_paper_pack).toBeNull();
  await page.getByRole("radio", { name: /^Picnic$/ }).check();
  await expect.poll(async () => (await choices(loop.groupId)).theme_tape_pack).toBeNull();
  await page.getByRole("radio", { name: /^Cherries$/ }).check();
  await expect.poll(async () => (await choices(loop.groupId)).theme_mascot).toBeNull();

  await gotoScheme(page, `/i/${delivered.issueId}?m=${alice.token}`, "light");
  for (const name of ["--page-image", "--paper-answer", "--tape-dots", "--mascot-image"]) {
    expect(await cssVar(page, name), name).toBe("");
  }
});

test("N6 · only the owner can dress the loop", async ({ page }) => {
  const { loop } = await seedWorld();
  await signIn(page, "alice@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page.getByRole("radio", { name: /^Hearts/ })).toHaveCount(0);
});

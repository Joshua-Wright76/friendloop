import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, runSweep, signIn } from "../support/harness";
import { TINY_PNG } from "../support/comments";
import { PAPER, chooseFile, cssVar, gotoScheme, seedWorld } from "../support/identity";

test.use({ reducedMotion: "reduce" });

test.beforeEach(async () => {
  await resetDatabase();
});

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: import("@playwright/test").Page, label: string) {
  // Audit the settled page. Colours ease between the schemes, and a sample taken
  // mid-ease reads as a blend of the two accents that never rests on screen.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  expect(result.violations, `${label}: ${result.violations.map((v) => `${v.id} (${v.nodes.length})`).join(", ")}`).toEqual([]);
}

test("N1 · the owner picks a paper and every member's surfaces wear it, light and dark", async ({ page }) => {
  const { loop, delivered, alice } = await seedWorld("n1-share-token");

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);

  // The settings show the original as chosen, and a live preview of both schemes.
  await expect(page.getByRole("radio", { name: /Gingham Picnic/ })).toBeChecked();
  await page.getByRole("radio", { name: /Meadow Postcard/ }).check();
  await expect(page.getByTestId("stationery-preview-light")).toBeVisible();
  await expect(page.getByTestId("stationery-preview-dark")).toBeVisible();
  expect(await page.getByTestId("stationery-preview-light").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(240, 246, 236)");
  expect(await page.getByTestId("stationery-preview-dark").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(24, 33, 27)");

  await page.getByRole("button", { name: "Save stationery" }).click();
  await expect(page.getByText("Stationery saved.")).toBeVisible();
  const [group] = await rows<{ theme_preset: string | null; theme_accent: string | null }>(
    "select theme_preset, theme_accent from groups where id = $1",
    [loop.groupId],
  );
  expect(group).toEqual({ theme_preset: "meadow", theme_accent: null });

  // Dashboard, reply sheet, web issue, and share view — in both schemes.
  const surfaces = [
    `/g/${loop.groupId}`,
    `/r/${alice.token}`,
    `/i/${delivered.issueId}?m=${alice.token}`,
    "/s/n1-share-token",
  ];
  for (const scheme of ["light", "dark"] as const) {
    for (const path of surfaces) {
      await gotoScheme(page, path, scheme);
      expect(await cssVar(page, "--page"), `${path} ${scheme}`).toBe(PAPER.meadow[scheme]);
    }
  }

  // And the email header: the same paper, from the same tokens.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' limit 1");
  expect(mail.html).toContain(PAPER.meadow.light);
  expect(mail.html).not.toContain("#cc3456");
});

test("N1 · an accent that would be hard to read is nudged, and every preset passes the audit in both schemes", async ({ page }) => {
  test.setTimeout(180_000);
  const { loop, delivered, alice } = await seedWorld();
  await signIn(page, "owner@friendloop.test");

  // Pale yellow on cream is the classic unreadable accent.
  await page.goto(`/g/${loop.groupId}/settings`);
  await page.getByRole("radio", { name: /Lilac Linen/ }).check();
  await page.getByLabel("Accent colour as a hex code").fill("#ffee00");
  await expect(page.getByText(/a little hard to read, so we nudged it/)).toBeVisible();
  await page.getByLabel("Accent colour as a hex code").fill("yellow-ish");
  await expect(page.getByText("Use a hex code like #3366cc.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save stationery" })).toBeDisabled();
  await page.getByLabel("Accent colour as a hex code").fill("#ffee00");
  await page.getByRole("button", { name: "Save stationery" }).click();
  await expect(page.getByText(/We nudged the accent a little/)).toBeVisible();
  const [saved] = await rows<{ theme_accent: string }>("select theme_accent from groups where id = $1", [loop.groupId]);
  expect(saved.theme_accent).toBe("#ffee00");

  // Reset returns the paper's own accent.
  await page.getByRole("button", { name: "Use the paper's own" }).click();
  await expect(page.getByText("Using the paper's own accent.")).toBeVisible();

  for (const preset of ["bluebell", "meadow", "marmalade", "lilac"] as const) {
    await rows("update groups set theme_preset = $2, theme_accent = null where id = $1", [loop.groupId, preset]);
    for (const scheme of ["light", "dark"] as const) {
      for (const path of [`/g/${loop.groupId}`, `/r/${alice.token}`, `/i/${delivered.issueId}?m=${alice.token}`]) {
        await gotoScheme(page, path, scheme);
        await expectAccessible(page, `${preset} ${scheme} ${path}`);
      }
    }
  }

  // The settings page itself, with the unreadable accent saved, in both schemes.
  await rows("update groups set theme_preset = 'lilac', theme_accent = '#ffee00' where id = $1", [loop.groupId]);
  for (const scheme of ["light", "dark"] as const) {
    await gotoScheme(page, `/g/${loop.groupId}/settings`, scheme);
    await expectAccessible(page, `settings ${scheme}`);
    await gotoScheme(page, `/i/${delivered.issueId}?m=${alice.token}`, scheme);
    await expectAccessible(page, `nudged accent ${scheme}`);
  }
});

test("N1 · a header picture shows above every surface and in the email; only the owner can set it", async ({ page, request }) => {
  const { loop, delivered, alice } = await seedWorld();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await chooseFile(page, "Choose a header picture", { name: "banner.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText("Header picture saved.")).toBeVisible();
  const [row] = await rows<{ header_image_url: string }>("select header_image_url from groups where id = $1", [loop.groupId]);
  expect(row.header_image_url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);

  for (const path of [`/g/${loop.groupId}`, `/r/${alice.token}`, `/i/${delivered.issueId}?m=${alice.token}`]) {
    await page.goto(path);
    await expect(page.locator(`img.loop-banner[src="${row.header_image_url}"]`)).toBeVisible();
  }

  await runSweep(DELIVERY_DAY);
  const mails = await rows<{ html: string }>("select html from outbox where kind in ('prompt', 'delivery')");
  expect(mails.length).toBeGreaterThan(0);
  for (const mail of mails) expect(mail.html).toContain(`<img src="${row.header_image_url}" alt=""`);

  // Something that cannot be read as a picture is refused before it leaves the browser
  // (a real oversize photo is shrunk instead: see T1).
  await page.goto(`/g/${loop.groupId}/settings`);
  await chooseFile(page, "Choose a header picture", { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(page.getByText("We couldn't read that picture.")).toBeVisible();

  // Removing it takes it off the pages.
  await page.getByRole("button", { name: "Remove picture" }).click();
  await expect(page.getByText("Header picture removed.")).toBeVisible();
  await page.goto(`/r/${alice.token}`);
  await expect(page.locator("img.loop-banner")).toHaveCount(0);

  // Anyone else — a contributor with only a reply link, or a stranger — is turned away.
  const form = { multipart: { photo: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG } } };
  const stranger = await request.post(`/api/loop/${loop.groupId}/header-image`, form);
  expect(stranger.status()).toBe(403);
  const strangerDelete = await request.delete(`/api/loop/${loop.groupId}/header-image`);
  expect(strangerDelete.status()).toBe(403);
  const [after] = await rows<{ header_image_url: string | null }>("select header_image_url from groups where id = $1", [loop.groupId]);
  expect(after.header_image_url).toBeNull();
});

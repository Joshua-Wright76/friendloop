import { test, expect } from "../support/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase, rows } from "../support/db";
import { DELIVERY_DAY, accentField, openPart, runSweep, signIn, unfoldLook } from "../support/harness";
import { TINY_PNG } from "../support/comments";
import { PAPER, chooseFile, cssVar, gotoScheme, seedWorld } from "../support/identity";
import { copy, copyPattern } from "@/lib/copy";

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
  await openPart(page, copy.settings.groupPaper);

  // The settings show the original as chosen, and a live preview of both schemes.
  await unfoldLook(page, copy.stationery.paperLegend);
  await expect(page.getByRole("radio", { name: copyPattern(copy.stationery.presets.gingham.name) })).toBeChecked();
  await unfoldLook(page, copy.stationery.paperLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.meadow.name) }).check();
  await expect(page.getByTestId("stationery-preview-light")).toBeVisible();
  await expect(page.getByTestId("stationery-preview-dark")).toBeVisible();
  expect(await page.getByTestId("stationery-preview-light").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(240, 246, 236)");
  expect(await page.getByTestId("stationery-preview-dark").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(24, 33, 27)");

  // Choosing a paper saves it.
  await expect(page.getByText(copy.stationery.statusSaved)).toBeVisible();
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

test("N1 · an accent that would be hard to read is nudged, validated, saved, and reset", async ({ page }) => {
  test.setTimeout(180_000);
  const { loop } = await seedWorld();
  await signIn(page, "owner@friendloop.test");

  // Pale yellow on cream is the classic unreadable accent.
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupPaper);
  await unfoldLook(page, copy.stationery.paperLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.lilac.name) }).check();
  await expect(page.getByText(copy.stationery.statusSaved)).toBeVisible();
  await (await accentField(page)).fill("#ffee00");
  await expect(page.getByText(copyPattern(copy.stationery.adjusted))).toBeVisible();
  await (await accentField(page)).fill("yellow-ish");
  await expect(page.getByText(copy.stationery.accentInvalid)).toBeVisible();
  // Leaving the field with something unusable saves nothing.
  await (await accentField(page)).blur();
  const [unsaved] = await rows<{ theme_accent: string | null }>("select theme_accent from groups where id = $1", [loop.groupId]);
  expect(unsaved.theme_accent).toBeNull();
  // Leaving it with a real colour saves that, and the nudge stays said.
  await (await accentField(page)).fill("#ffee00");
  await (await accentField(page)).blur();
  await expect(page.getByText(copyPattern(copy.stationery.adjusted))).toBeVisible();
  const accent = () => rows<{ theme_accent: string | null }>("select theme_accent from groups where id = $1", [loop.groupId]).then(([row]) => row.theme_accent);
  await expect.poll(accent).toBe("#ffee00");

  // Reset returns the paper's own accent.
  await page.getByRole("button", { name: copy.stationery.accentReset }).click();
  await expect(page.getByText(copy.stationery.accentUsing)).toBeVisible();
  await expect.poll(accent).toBeNull();
});

type World = Awaited<ReturnType<typeof seedWorld>>;

function auditPath(world: World, surface: "dashboard" | "reply" | "round") {
  if (surface === "dashboard") return `/g/${world.loop.groupId}`;
  if (surface === "reply") return `/r/${world.alice.token}`;
  return `/i/${world.delivered.issueId}?m=${world.alice.token}`;
}

// Keep each preset/surface/scheme axe audit independent: the old nested loops
// exceeded their timeout locally and could not be balanced across CI shards.
for (const preset of ["bluebell", "meadow", "marmalade", "lilac"] as const) {
  for (const surface of ["dashboard", "reply", "round"] as const) {
    for (const scheme of ["light", "dark"] as const) {
      test(`N1 · ${preset} preset audit · ${surface} · ${scheme}`, async ({ page }) => {
        test.setTimeout(180_000);
        const world = await seedWorld();
        await rows("update groups set theme_preset = $2, theme_accent = null where id = $1", [world.loop.groupId, preset]);
        // Preserve the signed-in session used by the original combined audit.
        await signIn(page, "owner@friendloop.test");
        const path = auditPath(world, surface);
        await gotoScheme(page, path, scheme);
        await expectAccessible(page, `${preset} ${scheme} ${path}`);
      });
    }
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`N1 · settings with an unreadable accent passes the audit · ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const { loop } = await seedWorld();
    await signIn(page, "owner@friendloop.test");
    await rows("update groups set theme_preset = 'lilac', theme_accent = '#ffee00' where id = $1", [loop.groupId]);
    await gotoScheme(page, `/g/${loop.groupId}/settings`, scheme);
    await expectAccessible(page, `settings ${scheme}`);
  });

  test(`N1 · a nudged accent on a round passes the audit · ${scheme}`, async ({ page }) => {
    test.setTimeout(180_000);
    const world = await seedWorld();
    await signIn(page, "owner@friendloop.test");
    await rows("update groups set theme_preset = 'lilac', theme_accent = '#ffee00' where id = $1", [world.loop.groupId]);
    await gotoScheme(page, `/i/${world.delivered.issueId}?m=${world.alice.token}`, scheme);
    await expectAccessible(page, `nudged accent ${scheme}`);
  });
}

test("N1 · a header picture shows above every surface and in the email; only the owner can set it", async ({ page, request }) => {
  const { loop, delivered, alice } = await seedWorld();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupPaper);
  await chooseFile(page, "Choose a header picture", { name: "banner.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText(copy.stationery.headerSaved)).toBeVisible();
  const [row] = await rows<{ header_image_url: string }>("select header_image_url from groups where id = $1", [loop.groupId]);
  expect(row.header_image_url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);

  for (const path of [`/g/${loop.groupId}`, `/r/${alice.token}`, `/i/${delivered.issueId}?m=${alice.token}`]) {
    await page.goto(path);
    await expect(page.locator(`.snapshot img[src="${row.header_image_url}"]`)).toBeVisible();
  }

  await runSweep(DELIVERY_DAY);
  const mails = await rows<{ html: string }>("select html from outbox where kind in ('prompt', 'delivery')");
  expect(mails.length).toBeGreaterThan(0);
  // Emails name a lasting address, not the stored file, which a new picture deletes.
  const lasting = `/api/loop/${loop.groupId}/header-image`;
  for (const mail of mails) expect(mail.html).toMatch(new RegExp(`<img src="https?://[^"]+${lasting}" alt=""`));
  const followed = await request.get(lasting, { maxRedirects: 0 });
  expect(followed.status()).toBe(302);
  expect(followed.headers().location).toBe(row.header_image_url);

  // Something that cannot be read as a picture is refused before it leaves the browser
  // (a real oversize photo is shrunk instead: see T1).
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, copy.settings.groupPaper);
  await chooseFile(page, "Choose a header picture", { name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(page.getByText(copy.identity.errors.unreadable)).toBeVisible();

  // Removing it takes it off the pages.
  await page.getByRole("button", { name: copy.stationery.headerRemove }).click();
  await expect(page.getByText(copy.stationery.headerRemoved)).toBeVisible();
  await page.goto(`/r/${alice.token}`);
  await expect(page.locator(".snapshot img, img.loop-banner")).toHaveCount(0);

  // Anyone else — a contributor with only a reply link, or a stranger — is turned away.
  const form = { multipart: { photo: { name: "x.png", mimeType: "image/png", buffer: TINY_PNG } } };
  const stranger = await request.post(`/api/loop/${loop.groupId}/header-image`, form);
  expect(stranger.status()).toBe(403);
  const strangerDelete = await request.delete(`/api/loop/${loop.groupId}/header-image`);
  expect(strangerDelete.status()).toBe(403);
  const [after] = await rows<{ header_image_url: string | null }>("select header_image_url from groups where id = $1", [loop.groupId]);
  expect(after.header_image_url).toBeNull();
});

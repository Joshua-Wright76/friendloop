import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { accentField, signIn, uniqueEmail, unfoldLooks, unfoldLook } from "../support/harness";
import { TINY_PNG } from "../support/comments";
import { PAPER, chooseFile, cssVar, gotoScheme } from "../support/identity";
import { copy, copyPattern } from "@/lib/copy";

const NEXT = "Continue to the next setup step";

test.beforeEach(async () => {
  await resetDatabase();
});

type Page = import("@playwright/test").Page;

async function toLookStep(page: Page, title: string) {
  await page.goto("/g/new");
  await page.getByLabel(copy.newLoop.nameLabel).fill(title);
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByRole("heading", { name: copy.newLoop.wizard.look.title })).toBeVisible();
  await unfoldLooks(page);
}

/** From the paper step through the questions, invitations and note to the end. */
async function createFromLookStep(page: Page) {
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/([0-9a-f-]+)\?welcome=1/);
}

test("B7 · the wizard sets the paper, accent and header picture, and they survive the other steps", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await toLookStep(page, "Meadow Mornings");

  // The same choices as the settings, starting from the original.
  await unfoldLook(page, copy.stationery.paperLegend);
  await expect(page.getByRole("radio", { name: copyPattern(copy.stationery.presets.gingham.name) })).toBeChecked();
  await unfoldLook(page, copy.stationery.paperLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.meadow.name) }).check();
  await expect(page.getByTestId("stationery-preview-light")).toBeVisible();
  await expect(page.getByTestId("stationery-preview-dark")).toBeVisible();
  await (await accentField(page)).fill("#2a6b3c");

  await chooseFile(page, "Choose a header picture", { name: "banner.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.locator("img.loop-banner")).toBeVisible();
  await expect(page.getByText(copy.newLoop.wizard.look.pictureChosen)).toBeVisible();

  // Moving on and coming back costs nothing.
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await unfoldLooks(page);
  await unfoldLook(page, copy.stationery.paperLegend);
  await expect(page.getByRole("radio", { name: copyPattern(copy.stationery.presets.meadow.name) })).toBeChecked();
  await expect(await accentField(page)).toHaveValue("#2a6b3c");
  await expect(page.locator("img.loop-banner")).toBeVisible();

  await createFromLookStep(page);
  const groupId = page.url().match(/\/g\/([0-9a-f-]+)/)![1];

  const [group] = await rows<{ theme_preset: string | null; theme_accent: string | null; header_image_url: string | null }>(
    "select theme_preset, theme_accent, header_image_url from groups where id = $1",
    [groupId],
  );
  expect(group.theme_preset).toBe("meadow");
  expect(group.theme_accent).toBe("#2a6b3c");
  expect(group.header_image_url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);

  // The very first page of the new loop already wears them.
  await expect(page.locator(`.snapshot img[src="${group.header_image_url}"]`)).toBeVisible();
  await gotoScheme(page, `/g/${groupId}`, "light");
  expect(await cssVar(page, "--page")).toBe(PAPER.meadow.light);
});

test("B7 · skipping the step changes nothing, and a bad accent or an oversize picture is stopped kindly", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await toLookStep(page, "Plain Loop");

  // A made-up accent holds the step; the words say what to do.
  await (await accentField(page)).fill("yellow-ish");
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByText(copy.stationery.accentInvalid)).toBeVisible();
  await expect(await accentField(page)).toBeFocused();
  await expect(page.getByRole("heading", { name: copy.newLoop.wizard.look.title })).toBeVisible();
  await page.getByRole("button", { name: copy.stationery.accentReset }).click();

  // A picture that cannot be read is refused before anything is sent.
  await chooseFile(page, "Choose a header picture", {
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  await expect(page.getByText(copy.identity.errors.unreadable)).toBeVisible();
  await expect(page.locator("img.loop-banner")).toHaveCount(0);

  await createFromLookStep(page);
  const [group] = await rows<{ theme_preset: string | null; theme_accent: string | null; header_image_url: string | null }>(
    "select theme_preset, theme_accent, header_image_url from groups where name = $1",
    ["Plain Loop"],
  );
  expect(group).toEqual({ theme_preset: null, theme_accent: null, header_image_url: null });
  await expect(page.locator(".snapshot img, img.loop-banner")).toHaveCount(0);
});

test("B7 · the wizard also offers the page, paper pack, tape pack and mascot, saved with the loop", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await toLookStep(page, "Dressed Up");

  await unfoldLook(page, copy.stationery.backgroundLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.backgrounds.daisies, { start: true }) }).check();
  await unfoldLook(page, copy.stationery.packLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.packs.watercolor.name, { start: true }) }).check();
  await unfoldLook(page, copy.stationery.tapeLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.tapes.candy, { start: true }) }).check();
  await unfoldLook(page, copy.stationery.mascotLegend);
  await page.getByRole("radio", { name: /^Snail/ }).check();

  // Tried on straight away, before the loop exists: the page behind, and the sheet itself.
  const backgroundOf = (selector: string) => page.locator(selector).first().evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(await backgroundOf("html")).toContain("data:image/svg+xml");
  expect(await backgroundOf(".wizard-sheet")).toContain("data:image/svg+xml");
  expect(await cssVar(page, "--mascot-image")).toContain("/stickers/snail.svg");
  // School notebook rules the words rather than the card, and still changes the sheet.
  await unfoldLook(page, copy.stationery.packLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.packs.schoolbook.name, { start: true }) }).check();
  expect(await backgroundOf(".wizard-sheet")).toContain("radial-gradient");
  // Plain cream takes it all off again.
  await unfoldLook(page, copy.stationery.packLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.packs.cream.name, { start: true }) }).check();
  expect(await backgroundOf(".wizard-sheet")).toBe("none");
  await unfoldLook(page, copy.stationery.packLegend);
  await page.getByRole("radio", { name: copyPattern(copy.stationery.packs.watercolor.name, { start: true }) }).check();

  // Moving on and coming back costs nothing.
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await unfoldLooks(page);
  await unfoldLook(page, copy.stationery.tapeLegend);
  await expect(page.getByRole("radio", { name: copyPattern(copy.stationery.tapes.candy, { start: true }) })).toBeChecked();

  await createFromLookStep(page);
  const [group] = await rows<Record<string, string | null>>(
    "select theme_background, theme_paper_pack, theme_tape_pack, theme_mascot from groups where name = $1",
    ["Dressed Up"],
  );
  expect(group).toEqual({ theme_background: "daisies", theme_paper_pack: "watercolor", theme_tape_pack: "candy", theme_mascot: "snail" });
});

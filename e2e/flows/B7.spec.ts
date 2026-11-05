import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";
import { TINY_PNG } from "../support/comments";
import { PAPER, chooseFile, cssVar, gotoScheme } from "../support/identity";

const NEXT = "Continue to the next setup step";

test.beforeEach(async () => {
  await resetDatabase();
});

type Page = import("@playwright/test").Page;

async function toLookStep(page: Page, title: string) {
  await page.goto("/g/new");
  await page.getByLabel("Loop title").fill(title);
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByRole("heading", { name: "Choose its paper and picture" })).toBeVisible();
}

/** From the paper step through the questions, invitations and note to the end. */
async function createFromLookStep(page: Page) {
  for (let index = 0; index < 3; index += 1) await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Create loop" }).click();
  await expect(page).toHaveURL(/\/g\/([0-9a-f-]+)\?welcome=1/);
}

test("B7 · the wizard sets the paper, accent and header picture, and they survive the other steps", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await toLookStep(page, "Meadow Mornings");

  // The same choices as the settings, starting from the original.
  await expect(page.getByRole("radio", { name: /Gingham Picnic/ })).toBeChecked();
  await page.getByRole("radio", { name: /Meadow Postcard/ }).check();
  await expect(page.getByTestId("stationery-preview-light")).toBeVisible();
  await expect(page.getByTestId("stationery-preview-dark")).toBeVisible();
  await page.getByLabel("Accent color as a hex code").fill("#2a6b3c");

  await chooseFile(page, "Choose a header picture", { name: "banner.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.locator("img.loop-banner")).toBeVisible();
  await expect(page.getByText("Picture ready.")).toBeVisible();

  // Moving on and coming back costs nothing.
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await expect(page.getByRole("radio", { name: /Meadow Postcard/ })).toBeChecked();
  await expect(page.getByLabel("Accent color as a hex code")).toHaveValue("#2a6b3c");
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
  await page.getByLabel("Accent color as a hex code").fill("yellow-ish");
  await page.getByRole("button", { name: NEXT }).click();
  await expect(page.getByText("Use a hex code like #3366cc.")).toBeVisible();
  await expect(page.getByLabel("Accent color as a hex code")).toBeFocused();
  await expect(page.getByRole("heading", { name: "Choose its paper and picture" })).toBeVisible();
  await page.getByRole("button", { name: "Use the paper's own" }).click();

  // A picture that cannot be read is refused before anything is sent.
  await chooseFile(page, "Choose a header picture", {
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(4 * 1024 * 1024 + 1),
  });
  await expect(page.getByText("We couldn't read that picture.")).toBeVisible();
  await expect(page.locator("img.loop-banner")).toHaveCount(0);

  await createFromLookStep(page);
  const [group] = await rows<{ theme_preset: string | null; theme_accent: string | null; header_image_url: string | null }>(
    "select theme_preset, theme_accent, header_image_url from groups where name = $1",
    ["Plain Loop"],
  );
  expect(group).toEqual({ theme_preset: null, theme_accent: null, header_image_url: null });
  await expect(page.locator(".snapshot img, img.loop-banner")).toHaveCount(0);
});

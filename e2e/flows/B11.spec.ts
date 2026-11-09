import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";
import { TINY_PNG } from "../support/comments";
import { chooseFile } from "../support/identity";
import { copy, copyPattern } from "@/lib/copy";

const NEXT = "Continue to the next setup step";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B11 · an interrupted setup picks up where it left off, and is gone once the loop is made", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.goto("/g/new");
  const progress = page.getByRole("progressbar", { name: copy.newLoop.wizard.stepAriaLabel });

  await page.getByLabel(copy.newLoop.nameLabel).fill("Kitchen Table");
  await page.getByRole("button", { name: copy.newLoop.cadences[1].label }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("radio", { name: copyPattern(copy.stationery.presets.meadow.name) }).check();
  await chooseFile(page, "Choose a header picture", { name: "banner.png", mimeType: "image/png", buffer: TINY_PNG });
  await expect(page.getByText(copy.newLoop.wizard.look.pictureChosen)).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.questions.ideas[0].question }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByLabel(copy.newLoop.wizard.readers.emailLabel).fill("ruth@friendloop.test");
  await page.getByLabel(copy.newLoop.wizard.readers.emailLabel).press("Enter");
  await expect(progress).toHaveAttribute("aria-valuenow", "4");

  // The tab is lost (a reload, or a phone dropping it while they look up an address).
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: copy.newLoop.wizard.resumed.notice })).toBeVisible();
  await expect(progress).toHaveAttribute("aria-valuenow", "4");
  await expect(page.getByText("ruth@friendloop.test")).toBeVisible();

  // Everything before it came back too.
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await expect(page.getByRole("button", { name: copy.newLoop.wizard.questions.ideas[0].question })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await expect(page.getByRole("radio", { name: copyPattern(copy.stationery.presets.meadow.name) })).toBeChecked();
  await expect(page.locator("img.loop-banner")).toBeVisible();
  await page.getByRole("button", { name: "Go to the previous setup step" }).click();
  await expect(page.getByLabel(copy.newLoop.nameLabel)).toHaveValue("Kitchen Table");
  await expect(page.getByRole("button", { name: copy.newLoop.cadences[1].label })).toHaveAttribute("aria-pressed", "true");

  for (let index = 0; index < 4; index += 1) await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/([0-9a-f-]+)\?welcome=1/);
  const groupId = page.url().match(/\/g\/([0-9a-f-]+)/)![1];
  const [group] = await rows<{ cadence_weeks: number; theme_preset: string | null; header_image_url: string | null }>(
    "select cadence_weeks, theme_preset, header_image_url from groups where id = $1",
    [groupId],
  );
  expect(group.cadence_weeks).toBe(Number(copy.newLoop.cadences[1].value));
  expect(group.theme_preset).toBe("meadow");
  expect(group.header_image_url).toBeTruthy();

  // The next new loop starts fresh.
  await page.goto("/g/new");
  await expect(page.getByLabel(copy.newLoop.nameLabel)).toHaveValue("");
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByText(copy.newLoop.wizard.resumed.notice)).toHaveCount(0);
});

test("B11 · starting over clears what was kept", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.goto("/g/new");
  await page.getByLabel(copy.newLoop.nameLabel).fill("Half Made");
  await page.getByRole("button", { name: NEXT }).click();

  await page.reload();
  await page.getByRole("button", { name: copy.newLoop.wizard.resumed.startOver }).click();
  const progress = page.getByRole("progressbar", { name: copy.newLoop.wizard.stepAriaLabel });
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await expect(page.getByLabel(copy.newLoop.nameLabel)).toHaveValue("");

  await page.reload();
  await expect(page.getByLabel(copy.newLoop.nameLabel)).toHaveValue("");
  await expect(page.getByText(copy.newLoop.wizard.resumed.notice)).toHaveCount(0);
});

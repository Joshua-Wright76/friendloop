import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { runSweep, signIn } from "../support/harness";
import { makePng } from "../support/audio";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K4 · a photo wall takes several photos with captions", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("The wall");
  await page.getByLabel("Kind").selectOption({ label: "Photo wall — up to six photos with captions" });
  await page.getByRole("button", { name: "Add section" }).click();
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  const wall = page.getByRole("region", { name: "And a little extra" });

  // Caption required before a photo joins the wall.
  await wall.getByLabel("Add a photo").first().setInputFiles({
    name: "first.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText("Give each photo on the wall a one-line caption.")).toBeVisible();
  await expect(page.getByPlaceholder("What's in this photo?").first()).toBeVisible(); // caption field stays
  const emptyCheck = await rows<{ count: number }>(
    "select count(*)::int as count from section_media",
  );
  expect(emptyCheck[0].count).toBe(0);

  // With a caption it lands.
  await page.getByLabel("Caption").first().fill("The whole table");
  await wall.getByLabel("Add a photo").first().setInputFiles({
    name: "first.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText("Photo added.")).toBeVisible();

  // The next photo gets its own caption before it lands.
  await page.getByLabel("Caption").first().fill("The leftovers");
  await wall.getByLabel("Add a photo").first().setInputFiles({
    name: "second.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText("Photo added.")).toBeVisible();
  await expect(page.getByText("The leftovers")).toBeVisible(); // both photos listed with captions
  const two = await rows<{ count: number }>("select count(*)::int as count from section_media");
  expect(two[0].count).toBe(2);

  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("The whole table")).toBeVisible();
  await expect(page.getByText("The leftovers")).toBeVisible();

  // Tapping a photo opens it full size, with the others a step away and a download.
  const first = page.getByRole("button", { name: /Open photo from .*: The whole table/ });
  await first.click();
  const viewer = page.getByRole("dialog", { name: "Photo viewer" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("Photo 1 of 2")).toBeVisible();
  await expect(viewer.getByText("The whole table")).toBeVisible();
  const download = viewer.getByRole("link", { name: "Download" });
  await expect(download).toHaveAttribute("download", /^friendloop-.+-1\.png$/);
  const [media] = await rows<{ url: string }>("select url from section_media order by position limit 1");
  await expect(download).toHaveAttribute("href", media.url);
  // Same-origin uploads honour the attribute, so the click really saves a file.
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toMatch(/^friendloop-.+-1\.png$/);

  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText("Photo 2 of 2")).toBeVisible();
  await expect(viewer.getByText("The leftovers")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(first).toBeFocused();
});

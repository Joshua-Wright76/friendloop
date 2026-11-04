import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { runSweep, signIn } from "../support/harness";
import { makePng } from "../support/audio";
import { makePhonePng } from "../support/images";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K3 · a standard section takes text and one photo", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByRole("button", { name: "Add section" }).click();
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  // The sections area carries its own photo button, separate from questions.
  const corner = page.getByRole("region", { name: "And a little extra" });
  await page.getByRole("textbox", { name: "The potluck corner" }).fill("Banana bread, again.");
  await corner.getByLabel("Add a photo").first().setInputFiles({
    name: "banana.png",
    mimeType: "image/png",
    buffer: makePng(),
  });
  await expect(page.getByText("Photo added.").first()).toBeVisible();

  // A second photo is refused: standard sections carry one. The form is gone at
  // the cap, so exercise the acceptance rule through the API.
  const [section] = await rows<{ id: string }>(
    "select iss.id from issue_sections iss where iss.title = 'The potluck corner' limit 1",
  );
  const refused = await page.request.post(`/api/reply/${alice.token}/section-media`, {
    multipart: {
      issueSectionId: section.id,
      caption: "",
      position: "1",
      photo: {
        name: "banana2.png",
        mimeType: "image/png",
        buffer: makePng(),
      },
    },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error).toContain("Standard sections");

  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("Banana bread, again.")).toBeVisible();
});

test("K3 · a phone-sized photo is shrunk in the browser and saves; one that can't fit is refused before upload", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByRole("button", { name: "Add section" }).click();
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  const corner = page.getByRole("region", { name: "And a little extra" });
  const uploads: number[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/section-media")) {
      uploads.push(request.postDataBuffer()?.length ?? 0);
    }
  });

  // Unreadable and over the cap: the browser says so without a round trip.
  await corner.getByLabel("Add a photo").first().setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
  });
  await expect(corner.getByText("That photo is over 4 MB. Try a smaller one.").first()).toBeVisible();
  expect(uploads).toEqual([]);

  // A 6000×4000 picture, ~10 MB on disk: more than a Vercel function accepts.
  const original = makePhonePng();
  expect(original.length).toBeGreaterThan(5 * 1024 * 1024);
  await corner.getByLabel("Add a photo").first().setInputFiles({
    name: "IMG_0001.png",
    mimeType: "image/png",
    buffer: original,
  });
  await expect(page.getByText("Photo added.").first()).toBeVisible({ timeout: 20_000 });

  // One request, comfortably under the platform's 4.5 MB body limit.
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toBeLessThan(4 * 1024 * 1024);

  const [media] = await rows<{ url: string }>("select url from section_media");
  expect(media.url).toMatch(/\/uploads\/[a-f0-9]{64}\.(?:webp|jpg)$/);
  const size = await page.evaluate(async (url) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, media.url);
  expect(size).toEqual([2560, 1707]);
});

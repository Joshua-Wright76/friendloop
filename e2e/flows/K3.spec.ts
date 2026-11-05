import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, runSweep, signIn } from "../support/harness";
import { makePng } from "../support/audio";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K3 · a standard section takes text and one photo", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
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
  await expect(page.getByRole("heading", { name: "Sent", exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("Banana bread, again.")).toBeVisible();
});

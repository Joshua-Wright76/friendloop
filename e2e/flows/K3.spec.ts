import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addWithCard, runSweep, signIn } from "../support/harness";
import { makePng } from "../support/audio";
import { chooseFile } from "../support/identity";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K3 · a written item asked every round takes text and one photo", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "The potluck corner", frequency: "Every round" });
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  // A standard section is a written card now: text, one photo, and the same rules as any answer.
  const corner = page.locator("section").filter({ has: page.getByRole("heading", { name: "The potluck corner" }) });
  await page.getByRole("textbox", { name: "The potluck corner" }).fill("Banana bread, again.");
  await chooseFile(page, "Add a photo", { name: "banana.png", mimeType: "image/png", buffer: makePng() }, corner);
  await expect(corner.getByText("Photo saved").first()).toBeVisible();

  // A sheet from before the switch still posts to the old endpoint: a second photo is refused there too.
  const [section] = await rows<{ id: string }>(
    "select id from issue_questions where text = 'The potluck corner' limit 1",
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

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("Banana bread, again.")).toBeVisible();
});

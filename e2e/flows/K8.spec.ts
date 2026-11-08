import { test, expect, type Page } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, openRowMenu, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

async function reword(page: Page, groupId: string, from: string, to: string) {
  await page.goto(`/g/${groupId}/questions`);
  await openPart(page, "Sections and dates");
  const item = page.getByLabel("Sections in order").locator("> li").last();
  await openRowMenu(page, `More for: ${from}`);
  await item.getByText("Edit").click();
  await item.getByLabel("Title").fill(to);
  await item.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByText("Section updated.")).toBeVisible();
}

test("K8 · editing a section reaches the open round, until someone has written in it", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByText("Section added.")).toBeVisible();

  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("The potluck corner", { exact: true })).toBeVisible();

  // Reworded while round one is open and nobody has written in it: round one reads the new words.
  await reword(page, loop.groupId, "The potluck corner", "The potluck corner, revisited");
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("The potluck corner, revisited", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "The potluck corner, revisited" }).fill("Banana bread, again.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();

  // Reworded again after Alice answered: her round keeps the words she answered.
  await reword(page, loop.groupId, "The potluck corner, revisited", "Bring a dish");
  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("The potluck corner, revisited")).toBeVisible();
  await expect(page.getByText("Bring a dish")).toHaveCount(0);

  // Round two, opened as round one went out, carries the latest words.
  const titles = await rows<{ title: string; number: number }>(
    `select iq.text as title, i.number from issue_questions iq
     join issues i on i.id = iq.issue_id
     join questions q on q.id = iq.question_id
     where q.frequency = 'every_round' and not q.active order by i.number asc`,
  );
  expect(titles).toEqual([
    { title: "The potluck corner, revisited", number: 1 },
    { title: "Bring a dish", number: 2 },
  ]);
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("Bring a dish", { exact: true })).toBeVisible();
});

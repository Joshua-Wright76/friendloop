import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("K8 · editing a section changes future issues, never an open one", async ({ page }) => {
  const loop = await seedLoop();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByPlaceholder("The potluck corner").fill("The potluck corner");
  await page.getByRole("button", { name: "Add section" }).click();
  await expect(page.getByText("Section added.")).toBeVisible();

  // Round one opens with the section as it reads now.
  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("The potluck corner", { exact: true })).toBeVisible();

  // The owner rewords it while round one is still open.
  await page.goto(`/g/${loop.groupId}/questions`);
  const sectionList = page.getByLabel("Sections in order").locator("li");
  const item = sectionList.last();
  await item.getByText("Edit").click();
  await item.getByLabel("Title").fill("The potluck corner, revisited");
  await item.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByText("Section updated.")).toBeVisible();

  // Round one delivers with the old wording; Alice answers inside their copy.
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("The potluck corner", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "The potluck corner" }).fill("Banana bread, again.");
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByText("Sent").first()).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("The potluck corner")).toBeVisible();
  await expect(page.getByText("The potluck corner, revisited")).toHaveCount(0);

  // The next opened rounds carry the new wording; the delivered one keeps its copy.
  await runSweep(new Date("2026-01-16T08:00:00Z"));
  const titles = await rows<{ title: string }>(
    "select s.title from issue_sections s inner join issues i on i.id = s.issue_id order by i.number asc",
  );
  expect(titles[0].title).toBe("The potluck corner");
  expect(titles.slice(1).every((row) => row.title === "The potluck corner, revisited")).toBe(true);

  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText("The potluck corner, revisited")).toBeVisible();
  await expect(page.getByText("The potluck corner", { exact: true })).toHaveCount(0);
});

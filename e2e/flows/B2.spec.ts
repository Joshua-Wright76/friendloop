import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";

const NEXT = "Continue to the next setup step";

async function moveToDetails(page: import("@playwright/test").Page, title: string) {
  await page.goto("/g/new");
  await page.getByLabel("Loop title").fill(title);
  await page.getByRole("button", { name: NEXT }).click();
}

async function continueFromReaders(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: NEXT }).click();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("B2 · defaults and section prompts become the ordered question pool", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Book Club");

  const questions = page.getByRole("checkbox");
  await expect(questions.nth(0)).toBeChecked();
  await expect(questions.nth(1)).toBeChecked();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: /Bright spots/ }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await continueFromReaders(page);

  await page.getByRole("button", { name: "Preview the first issue" }).click();
  const preview = page.getByRole("dialog", { name: "A first look" });
  await expect(preview.getByText("Book Club")).toBeVisible();
  await expect(preview.getByText("Bright spots: What was one good moment from your week?")).toBeVisible();
  await preview.getByRole("button", { name: "Close issue preview" }).click();
  await page.getByRole("button", { name: "Create loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const pool = await rows<{ text: string; position: number }>(
    `select q.text, q.position from questions q
     join groups g on g.id = q.group_id where g.name = $1 order by q.position`,
    ["Book Club"],
  );
  expect(pool.map((row) => row.text)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    "Bright spots: What was one good moment from your week?",
  ]);
  expect(pool.map((row) => row.position)).toEqual([0, 1, 2]);
});

test("B2 · the question bank can start with more than eight prompts", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Long Table");

  const questions = page.getByRole("checkbox");
  await expect(questions).toHaveCount(13);
  for (let index = 0; index < 9; index += 1) await questions.nth(index).check();
  await expect(page.getByText("9 selected")).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Create loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const count = await rows<{ count: number }>(
    `select count(*)::int as count from questions q
     join groups g on g.id = q.group_id where g.name = $1`,
    ["Long Table"],
  );
  expect(count).toEqual([{ count: 9 }]);
});

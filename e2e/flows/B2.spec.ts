import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B2 · the questions you pick become the loop's starting pool, in order", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));

  await page.goto("/g/new");
  await page.getByLabel("Name").fill("Book Club");
  await page.getByRole("checkbox", { name: /What made you laugh this week/ }).first().check();
  await page.getByRole("checkbox", { name: /What are you looking forward to/ }).first().check();
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
  ]);
  expect(pool.map((row) => row.position)).toEqual([0, 1]);
});

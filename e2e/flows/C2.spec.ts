import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C2 · moving a question changes the order the next round uses", async ({ page }) => {
  const loop = await seedLoop(); // two questions seeded
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByRole("button", { name: "Down" }).first().click();

  await expect(page.locator("ol > li").first()).toContainText("What are you looking forward to?");

  const order = await rows<{ text: string }>(
    "select text from questions where group_id = $1 order by position",
    [loop.groupId],
  );
  expect(order.map((row) => row.text)).toEqual([
    "What are you looking forward to?",
    "What made you laugh this week?",
  ]);
});

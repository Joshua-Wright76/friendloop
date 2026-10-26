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

  // The list reorders optimistically, so the visible order can lead the write.
  await expect(page.locator("ol > li").first()).toContainText("What are you looking forward to?");

  const order = () =>
    rows<{ text: string }>(
      "select text from questions where group_id = $1 order by position",
      [loop.groupId],
    ).then((result) => result.map((row) => row.text));

  await expect.poll(order).toEqual([
    "What are you looking forward to?",
    "What made you laugh this week?",
  ]);
});

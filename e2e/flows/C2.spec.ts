import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openRowMenu, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C2 · moving a question changes the order the next round uses", async ({ page }) => {
  const loop = await seedLoop(); // two questions seeded
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await openRowMenu(page);
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

test("C2 · the handle drags the whole question card", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.addInitScript(() => {
    const setDragImage = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function (image, x, y) {
      (window as Window & { questionDragImage?: Element }).questionDragImage = image;
      setDragImage.call(this, image, x, y);
    };
  });

  await page.goto(`/g/${loop.groupId}/questions`);
  const cards = page.getByRole("list", { name: "Questions in round order" }).locator("> li");
  const firstCard = cards.first();
  await expect(firstCard.locator(".row > :first-child")).toHaveAttribute("data-control", "handle");
  await firstCard.getByRole("button", { name: "Move question: What made you laugh this week?" }).dragTo(cards.nth(1));

  const dragImage = await page.evaluate(() => {
    const image = (window as Window & { questionDragImage?: Element }).questionDragImage;
    return image ? { className: image.className, text: image.textContent } : null;
  });
  expect(dragImage?.className).toContain("question-order-item");
  expect(dragImage?.text).toContain("What made you laugh this week?");
  await expect(cards.first()).toContainText("What are you looking forward to?");
});

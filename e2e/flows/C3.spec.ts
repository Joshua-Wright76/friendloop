import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { openItem, signIn, unfold } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C3 · stop asking folds an item into Stopped, past rounds keep it, and Ask again brings it back", async ({ page }) => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "the cat" }],
  });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);

  const row = await openItem(page, "What made you laugh this week?");
  await row.getByRole("button", { name: "Stop asking: What made you laugh this week?" }).click();
  await row.getByRole("button", { name: "Yes, stop asking" }).click(); // stopping asks first
  await expect(page.getByText("Stopped asking. It's under Stopped if you want it back.")).toBeVisible();

  const asked = await rows<{ text: string }>("select text from questions where group_id = $1 and archived_at is null", [loop.groupId]);
  expect(asked.map((item) => item.text)).toEqual(["What are you looking forward to?"]);
  const snapshot = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(snapshot[0].text).toBe("What made you laugh this week?");

  await unfold(page, "Stopped (1)");
  await page.getByRole("button", { name: "Ask again: What made you laugh this week?" }).click();
  await expect(page.getByText("Asking it again. It's in Up next.")).toBeVisible();
  const back = await rows<{ text: string }>("select text from questions where group_id = $1 and archived_at is null order by position", [loop.groupId]);
  expect(back.map((item) => item.text)).toEqual(["What are you looking forward to?", "What made you laugh this week?"]);
  await expect(page.getByText("Stopped (1)")).toHaveCount(0);
});

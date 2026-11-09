import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { openItem, signIn, unfold } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

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

  const row = await openItem(page, copy.questionPacks[0].questions[0]);
  await row.getByRole("button", { name: copyText(copy.questions.item.stopLabel, { item: copy.questionPacks[0].questions[0] }) }).click();
  await row.getByRole("button", { name: copy.questions.item.stopConfirm }).click(); // stopping asks first
  await expect(page.getByText(copy.questions.done.stopped)).toBeVisible();

  const asked = await rows<{ text: string }>("select text from questions where group_id = $1 and archived_at is null", [loop.groupId]);
  expect(asked.map((item) => item.text)).toEqual([copy.questionPacks[0].questions[1]]);
  const snapshot = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(snapshot[0].text).toBe(copy.questionPacks[0].questions[0]);

  await unfold(page, copyText(copy.questions.item.stoppedTitle, { count: "1" }));
  await page.getByRole("button", { name: copyText(copy.questions.item.askAgainLabel, { item: copy.questionPacks[0].questions[0] }) }).click();
  await expect(page.getByText(copy.questions.done.again)).toBeVisible();
  const back = await rows<{ text: string }>("select text from questions where group_id = $1 and archived_at is null order by position", [loop.groupId]);
  expect(back.map((item) => item.text)).toEqual([copy.questionPacks[0].questions[1], copy.questionPacks[0].questions[0]]);
  await expect(page.getByText(copyText(copy.questions.item.stoppedTitle, { count: "1" }))).toHaveCount(0);
});

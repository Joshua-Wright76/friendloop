import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { openRowMenu, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C3 · archiving removes it from the pool but past rounds keep the wording", async ({ page }) => {
  const loop = await seedLoop();
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "the cat" }],
  });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await openRowMenu(page);
  await page.getByRole("button", { name: /^Archive/ }).first().click();
  await page.getByRole("button", { name: /^Yes, archive/ }).click(); // archiving asks first
  await expect(page.getByText(/Archived/)).toBeVisible();

  const active = await rows<{ text: string }>(
    "select text from questions where group_id = $1 and archived_at is null",
    [loop.groupId],
  );
  expect(active.map((row) => row.text)).toEqual(["What are you looking forward to?"]);

  const snapshot = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(snapshot[0].text).toBe("What made you laugh this week?");
});

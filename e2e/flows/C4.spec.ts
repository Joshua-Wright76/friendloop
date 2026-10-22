import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C4 · skipping a question affects one round only", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByRole("button", { name: "Skip next round" }).first().click();
  await expect(page.getByText("Sitting out the next round")).toBeVisible();

  await runSweep(AFTER_FIRST_SLOT);
  const first = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(first.map((row) => row.text)).toEqual(["What are you looking forward to?"]);

  // The next round gets it back.
  await runSweep(new Date("2026-01-09T08:05:00Z"));
  const second = await rows<{ text: string }>(
    `select iq.text from issue_questions iq
     join issues i on i.id = iq.issue_id
     where i.number = 2 order by iq.position`,
  );
  expect(second.map((row) => row.text)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
  ]);
});

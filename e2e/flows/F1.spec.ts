import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, pickOption, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F1 · a schedule change moves the next round and leaves an open one alone", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/settings`);
  // The schedule fields are Pickers, not native selects.
  await pickOption(page, "Day", "Monday");
  await pickOption(page, "Time", "18:00");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const [group] = await rows<{ prompt_weekday: number; prompt_hour: number }>(
    "select prompt_weekday, prompt_hour from groups where id = $1",
    [loop.groupId],
  );
  expect(group).toEqual({ prompt_weekday: 1, prompt_hour: 18 });

  const [stillOpen] = await rows<{ delivers_at: string }>(
    "select delivers_at from issues where id = $1",
    [issue.issueId],
  );
  expect(new Date(stillOpen.delivers_at).toISOString()).toBe(issue.deliversAt.toISOString());

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(/Monday at 18:00/)).toBeVisible();
});

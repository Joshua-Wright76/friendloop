import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, clockHeaders, pickOption, signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F1 · a schedule change moves when it goes out, the open round included", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await signIn(page, "owner@friendloop.test");
  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));

  await page.goto(`/g/${loop.groupId}/settings`);
  // The schedule fields are Pickers, not native selects.
  await pickOption(page, copy.settings.day, "Monday");
  await pickOption(page, copy.settings.time, "6:00 PM");
  await page.getByRole("button", { name: copy.settings.save }).click();
  await expect(page.getByText(copy.settings.savedNotice)).toBeVisible();

  const [group] = await rows<{ prompt_weekday: number; prompt_hour: number }>(
    "select prompt_weekday, prompt_hour from groups where id = $1",
    [loop.groupId],
  );
  expect(group).toEqual({ prompt_weekday: 1, prompt_hour: 18 });

  // The round people are writing goes out on the new day: Monday 18:00 Amsterdam.
  const [moved] = await rows<{ delivers_at: string }>(
    "select delivers_at from issues where id = $1",
    [issue.issueId],
  );
  expect(new Date(moved.delivers_at).toISOString()).toBe("2026-01-05T17:00:00.000Z");

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(/Monday at 6:00 PM/)).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D6 · a submitted answer can still be rewritten, not duplicated", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const answer = page.getByLabel("What made you laugh this week?");
  await answer.fill("First version.");
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.locator(".sent-stamp")).toHaveClass(/sent-stamp-animate/);

  await answer.fill("Second version, with the good detail.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator(".sent-stamp")).not.toHaveClass(/sent-stamp-animate/);
  await expect(page.getByLabel("What made you laugh this week?")).toHaveValue(
    "Second version, with the good detail.",
  );

  const saved = await rows<{ body: string; status: string }>(
    `select body, status from replies where issue_id = $1 and membership_id = $2`,
    [issue.issueId, alice.id],
  );
  expect(saved, "one row per question, updated in place").toHaveLength(1);
  expect(saved[0].body).toBe("Second version, with the good detail.");
  expect(saved[0].status).toBe("submitted");
});

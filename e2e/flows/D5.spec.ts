import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D5 · sending marks the answers submitted and says so", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("A cat fist bump.");
  await page.getByLabel("What are you looking forward to?").fill("Friday, obviously.");

  await page.getByRole("button", { name: "Send answers" }).click();

  await expect(page.getByText(/Sent\. You can change these until/)).toBeVisible();
  // The confirmation repeats the real deadline, computed on the server.
  await expect(
    page.getByText(/Sent\. You can change these until Friday 9:05 AM/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

  const saved = await rows<{ status: string; submitted_at: string | null }>(
    `select status, submitted_at from replies
     where issue_id = $1 and membership_id = $2
     order by created_at`,
    [issue.issueId, alice.id],
  );
  expect(saved).toHaveLength(2);
  for (const row of saved) {
    expect(row.status).toBe("submitted");
    expect(row.submitted_at).not.toBeNull();
  }
});

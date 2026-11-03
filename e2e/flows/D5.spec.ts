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

  // A screen of its own says it went, with focus on it, and the sheet steps aside.
  const heading = page.getByRole("heading", { name: "Sent", exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByText("Your answers are in for Round 1.")).toBeVisible();
  // The confirmation repeats the real deadline, computed on the server, and the
  // reader's own time when their zone differs from the loop's, as the sheet does.
  await expect(
    page.getByText(/^It goes out to everyone Friday 9:05 AM( \(.+ where you are\))?\. Until then, you can change anything\.$/),
  ).toBeVisible();
  await expect(page.getByLabel("What made you laugh this week?")).toBeHidden();

  // "Edit my answers" brings the sheet back, answers intact, ready to change.
  await page.getByRole("button", { name: "Edit my answers" }).click();
  await expect(page.getByLabel("What made you laugh this week?")).toHaveValue("A cat fist bump.");
  await expect(page.getByText(/Sent\. You can change these until Friday 9:05 AM/)).toBeVisible();
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

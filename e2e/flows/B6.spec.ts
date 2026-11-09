import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, signIn, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B6 · a link nobody opened for months still opens the sheet and takes an answer", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  // Invited four months before "now", and never opened: under the old rules this was long dead.
  const slow = await addMember(loop, {
    email: "slow@friendloop.test",
    name: "Slow",
    invitedDaysAgo: 120,
    accepted: false,
  });

  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${slow.token}`);
  await waitForSheet(page);
  await expect(page.getByText(/expired/i)).toHaveCount(0);
  await page.getByLabel("What made you laugh this week?").fill("Better late than never.");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  const [written] = await rows<{ count: number }>(
    "select count(*)::int as count from replies r join memberships m on m.id = r.membership_id where m.email = 'slow@friendloop.test'",
  );
  expect(written.count).toBe(1);
  const [membership] = await rows<{ accepted_at: Date | null }>("select accepted_at from memberships where id = $1", [slow.id]);
  expect(membership.accepted_at, "the first answer counts as having joined").not.toBeNull();
});

test("B6 · the people page shows no invitation state: a quiet note for a contributor, nothing for a reader", async ({ page }) => {
  const loop = await seedLoop();
  await addMember(loop, { email: "quiet@friendloop.test", name: "Quiet", invitedDaysAgo: 60, accepted: false });
  await addMember(loop, { email: "rae@friendloop.test", name: "Rae", participation: "reader", invitedDaysAgo: 60, accepted: false });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  const quiet = page.locator(".member-list > li").filter({ hasText: "quiet@friendloop.test" });
  await expect(quiet.getByText("Hasn't answered anything yet")).toBeVisible();
  const reader = page.locator(".member-list > li").filter({ hasText: "rae@friendloop.test" });
  await expect(reader.getByText("Hasn't answered anything yet")).toHaveCount(0);
  await expect(page.getByText(/expired|not opened/i)).toHaveCount(0);
  // The same link can always be sent again.
  await expect(reader.getByRole("button", { name: "Resend invitation" })).toBeVisible();
});

test("B6 · removing someone is what ends a link", async ({ page }) => {
  const loop = await seedLoop();
  const gone = await addMember(loop, { email: "gone@friendloop.test", invitedDaysAgo: 3 });
  await rows("update memberships set revoked_at = now() where id = $1", [gone.id]);

  await page.goto(`/r/${gone.token}`);
  await expect(page.getByRole("heading", { name: "This link doesn't work anymore" })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
});

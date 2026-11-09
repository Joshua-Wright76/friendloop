import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "./support/db";
import { seedLoop } from "./support/seed";
import { signIn } from "./support/harness";
import { copy } from "@/lib/copy";

// Chromium with touch, not the phone project: WebKit drops the signed-in session's
// Secure cookie on http://localhost, and this page needs a signed-in owner.
test.use({ hasTouch: true, viewport: { width: 393, height: 852 } });

test.beforeEach(async () => {
  await resetDatabase();
});

/**
 * Leaving the field turns its address into a chip, which pushes the button down. On a
 * phone that happened mid-tap, so the first tap landed on nothing and nothing was sent.
 */
test("a single tap on Send invitations sends what was typed", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  await page.getByLabel(copy.members.inviteAriaLabel).fill("fan@friendloop.test");
  await page.getByRole("button", { name: copy.members.sendInvitations }).tap();

  await expect(page.getByText(copy.members.invitedNotice)).toBeVisible();
  const invited = await rows("select id from memberships where email = 'fan@friendloop.test'");
  expect(invited).toHaveLength(1);
});

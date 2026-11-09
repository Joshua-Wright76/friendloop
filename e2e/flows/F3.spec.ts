import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F3 · removing someone revokes their link but keeps what they wrote", async ({ page }) => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "bob@friendloop.test", body: "Something Bob said." }],
  });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const bobCard = page.locator(".card").filter({ hasText: "bob@friendloop.test" });
  await bobCard.getByRole("button", { name: copyPattern(copy.a11yLabels.removeMember, { start: true }) }).click();
  await bobCard.getByRole("button", { name: copyPattern(copy.a11yLabels.removeMemberConfirm, { start: true }) }).click(); // removing asks first
  await expect(page.getByText(copy.members.removedNotice)).toBeVisible();

  await page.goto(`/r/${bob.token}`);
  await expect(page.getByRole("heading", { name: /doesn't work anymore/i })).toBeVisible();

  const kept = await rows<{ count: number }>(
    "select count(*)::int as count from replies where membership_id = $1",
    [bob.id],
  );
  expect(kept[0].count).toBe(1);
});

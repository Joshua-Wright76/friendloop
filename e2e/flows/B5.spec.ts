import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B5 · resending an invite sends again without a second membership", async ({ page }) => {
  const loop = await seedLoop();
  await addMember(loop, { email: "pending@friendloop.test", accepted: false });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByRole("button", { name: "Resend invitation" }).click();
  await expect(page.getByText("Invitation sent again.")).toBeVisible();

  const sent = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'invite'",
  );
  expect(sent[0].count).toBe(1);

  const people = await rows<{ count: number }>(
    "select count(*)::int as count from memberships where email = $1",
    ["pending@friendloop.test"],
  );
  expect(people[0].count).toBe(1);
});

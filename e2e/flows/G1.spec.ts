import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G1 · a reader is invited, reads, and is never asked to answer", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByLabel("Email addresses").fill("reader@friendloop.test");
  await page.getByLabel("Invite them as readers").check();
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText("Invitations sent.")).toBeVisible();

  const reader = await rows<{ reply_token: string; participation: string }>(
    "select reply_token, participation from memberships where email = $1",
    ["reader@friendloop.test"],
  );
  expect(reader[0].participation).toBe("reader");

  await runSweep(AFTER_FIRST_SLOT);
  const promptsToReader = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'prompt' and \"to\" = $1",
    ["reader@friendloop.test"],
  );
  expect(promptsToReader[0].count).toBe(0);

  await page.goto(`/r/${reader[0].reply_token}`);
  await expect(page.getByRole("heading", { name: /reader/i })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
});

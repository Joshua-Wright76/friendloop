import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G6 · a from-you loop makes everyone else a reader", async ({ page }) => {
  const loop = await seedLoop({ mode: "from_you" });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByLabel("Invite people by email").fill("fan@friendloop.test");
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText("Invitations sent.")).toBeVisible();

  const [invited] = await rows<{ participation: string }>(
    "select participation from memberships where email = $1",
    ["fan@friendloop.test"],
  );
  expect(invited.participation).toBe("reader");

  await expect(page.getByLabel("Invite them as readers")).toHaveCount(0);
});

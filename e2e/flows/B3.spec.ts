import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B3 · inviting three people sends three emails with their own links", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const emailInput = page.getByLabel("Invite people by email");
  await emailInput.fill("ana@friendloop.test, ben@friendloop.test; cleo@friendloop.test owner@friendloop.test ana@friendloop.test");
  await emailInput.press("Enter");
  // The invite form sits above the list now.
  await expect(page.locator("#invite-people").getByText(/@friendloop\.test/)).toHaveCount(4);
  await page.getByRole("button", { name: "Send invitations" }).click();

  await expect(page.getByText("3 invitations sent. 1 already in the loop.")).toBeVisible();

  const invited = await rows<{ email: string }>(
    "select email from memberships where group_id = $1 and email like '%@friendloop.test' and email in ($2,$3,$4) order by email",
    [loop.groupId, "ana@friendloop.test", "ben@friendloop.test", "cleo@friendloop.test"],
  );
  expect(invited.map((row) => row.email)).toEqual([
    "ana@friendloop.test",
    "ben@friendloop.test",
    "cleo@friendloop.test",
  ]);

  const emails = await rows<{ to: string; html: string }>(
    "select \"to\", html from outbox where kind = 'invite' order by \"to\"",
  );
  expect(emails).toHaveLength(3);
  for (const email of emails) {
    expect(email.html).toContain("/r/");
  }
  expect(new Set(emails.map((email) => email.html.match(/\/r\/[A-Za-z0-9_-]+/)?.[0])).size).toBe(3);
});

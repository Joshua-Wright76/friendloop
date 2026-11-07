import { test, expect } from "@playwright/test";
import { latestOutbox, linkFrom, resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("V5 · moving an account to a new address, confirmed from that inbox", async ({ page }) => {
  await seedLoop();
  await signIn(page, "owner@friendloop.test");

  await page.goto("/you");
  await page.getByLabel("New email address").fill("new-owner@friendloop.test");
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByText("Check new-owner@friendloop.test for the link.")).toBeVisible();

  // Opening the link changes nothing: mail scanners open links too.
  const mail = await latestOutbox("email-change:");
  await page.goto(linkFrom(mail!.html, "/you/email/confirm"));
  await expect(page.getByText("new-owner@friendloop.test")).toBeVisible();
  const before = await rows<{ count: number }>("select count(*)::int as count from users where email = 'new-owner@friendloop.test'");
  expect(before[0].count).toBe(0);

  await page.getByRole("button", { name: "Yes, use this address" }).click();
  await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();

  await page.getByRole("link", { name: "Back to your loops" }).click();
  await expect(page.getByText("Signed in as new-owner@friendloop.test")).toBeVisible();

  const moved = await rows<{ email: string }>("select email from memberships where access = 'owner'");
  expect(moved[0].email).toBe("new-owner@friendloop.test");
});

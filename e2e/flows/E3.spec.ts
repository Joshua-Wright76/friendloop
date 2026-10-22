import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E3 · a member can comment and it sticks", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await page.getByLabel("Comment").fill("This made my morning.");
  await page.getByRole("button", { name: "Post" }).click();

  await expect(page.getByText("This made my morning.")).toBeVisible();

  const saved = await rows<{ body: string }>("select body from comments");
  expect(saved).toHaveLength(1);
  expect(saved[0].body).toBe("This made my morning.");
});

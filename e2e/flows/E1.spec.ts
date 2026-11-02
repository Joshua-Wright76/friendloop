import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E1 · a delivered round shows every answer and marks your own", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [
      { email: "alice@friendloop.test", body: "The cat fist bump." },
      { email: "bob@friendloop.test", body: "A very long lunch.", questionIndex: 1 },
    ],
  });

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);

  await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
  await expect(page.getByText("The cat fist bump.")).toBeVisible();
  await expect(page.getByText("A very long lunch.")).toBeVisible();
  await expect(page.getByText("2 answers from the group.")).toBeVisible();
  await expect(page.getByText("Delivered Friday 30 October.")).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  // Scoped to the answers: the reading controls above them also name Bob.
  await expect(page.locator(".answer-card").getByText("Bob", { exact: true })).toBeVisible();
});

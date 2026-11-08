import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, clockHeaders, runSweep } from "../support/harness";

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

  await expect(page.getByRole("heading", { name: "Issue 1" })).toBeVisible();
  await expect(page.getByText("The cat fist bump.")).toBeVisible();
  await expect(page.getByText("A very long lunch.")).toBeVisible();
  await expect(page.getByText("2 answers from the group.")).toBeVisible();
  await expect(page.getByText(/Delivered Fri 30 Oct\./)).toBeVisible();
  await expect(page.getByText("You", { exact: true })).toBeVisible();
  // Scoped to the answers: the reading controls above them also name Bob.
  await expect(page.locator(".answer-card").getByText("Bob", { exact: true })).toBeVisible();
});


test("E1 · an open round says when it goes out, not that it was delivered", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));
  await page.goto(`/i/${issue.issueId}?m=${encodeURIComponent(alice.token)}`);
  await expect(page.getByText(/Goes out /)).toBeVisible();
  await expect(page.getByText(/Delivered /)).toHaveCount(0);
});

test("E1 · once a round has gone out, its reply sheet stops promising a deadline", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "Geese." }] });
  await runSweep(issue.deliversAt);
  // A loop from before rounds ran back to back: no round after this one, so the
  // link stays on the one that went out.
  await rows("update issues set status = 'skipped' where group_id = $1 and number = 2", [loop.groupId]);

  await page.setExtraHTTPHeaders(clockHeaders(new Date(issue.deliversAt.getTime() + 60_000)));
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText(/Went out /)).toBeVisible();
  await expect(page.getByText(/^Goes out /)).toHaveCount(0);
});

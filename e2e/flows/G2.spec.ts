import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G2 · switching someone to reader stops prompts and keeps their answers", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Already in." }],
  });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  const aliceCard = page.locator(".card").filter({ hasText: "alice@friendloop.test" });
  await aliceCard.getByRole("button", { name: "Make a reader" }).click();

  const [row] = await rows<{ participation: string }>(
    "select participation from memberships where id = $1",
    [alice.id],
  );
  expect(row.participation).toBe("reader");

  await runSweep(new Date("2026-01-09T08:05:00Z"));
  const promptsToAlice = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'prompt' and \"to\" = $1",
    ["alice@friendloop.test"],
  );
  expect(promptsToAlice[0].count, "no new prompts once they only read").toBe(0);

  const kept = await rows<{ count: number }>(
    "select count(*)::int as count from replies where membership_id = $1",
    [alice.id],
  );
  expect(kept[0].count).toBe(1);
});

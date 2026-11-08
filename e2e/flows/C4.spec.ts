import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { openRowMenu, signIn } from "../support/harness";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const LAUGH = "What made you laugh this week?";
const AHEAD = "What are you looking forward to?";

test("C4 · skipping a question takes it out of the open round only", async ({ page }) => {
  const loop = await seedLoop();
  await runSweep(AFTER_FIRST_SLOT);
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await openRowMenu(page);
  await page.getByRole("button", { name: "Skip this round" }).first().click();
  await expect(page.getByText("Sitting out this round")).toBeVisible();

  const first = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(first.map((row) => row.text)).toEqual([AHEAD]);

  // Round 1 goes out, and round 2, opening as it does, asks it again.
  const [round] = await rows<{ id: string }>("select id from issues where group_id = $1 and number = 1", [loop.groupId]);
  await seedReplies({ issueId: round.id, membershipId: loop.members[1].id, answers: [{ text: AHEAD, body: "Spring." }] });
  await runSweep(new Date("2026-01-09T08:05:00Z"));
  const second = await rows<{ text: string }>(
    `select iq.text from issue_questions iq
     join issues i on i.id = iq.issue_id
     where i.number = 2 order by iq.position`,
  );
  expect(second.map((row) => row.text)).toEqual([LAUGH, AHEAD]);
});

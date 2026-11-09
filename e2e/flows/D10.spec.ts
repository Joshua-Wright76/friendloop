import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D10 · the owner nudges whoever is still missing, and can do it again", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(copy.loop.waitingTitle)).toBeVisible();
  await expect(page.locator(".person-pill", { hasText: "Alice" })).toBeVisible();

  // Both nudge rounds land on the same URL, so wait on the rows rather than the
  // address bar: the second click is still in flight while the page re-renders.
  const reminderKeys = async (): Promise<string[]> => {
    const sent = await rows<{ dedupe_key: string }>(
      "select dedupe_key from outbox where kind = 'reminder'",
    );
    return sent.map((row) => row.dedupe_key);
  };

  await page.getByRole("button", { name: copyPattern(copy.loop.nudgeNamed, { values: { names: /.*Alice.*/ }, start: true }) }).click();
  await page.getByRole("button", { name: copy.loop.nudgeConfirm }).click();
  // Alice and Bob: the owner, also still waiting, doesn't nudge themselves.
  await expect(page.getByText(text(copy.loop.nudged, { count: "2" }))).toBeVisible();
  await expect.poll(reminderKeys).toHaveLength(2);
  expect(new Set(await reminderKeys()).size).toBe(2);

  // A second nudge is a second gentle email, not a duplicate row.
  await page.getByRole("button", { name: copyPattern(copy.loop.nudgeAgainLabel, { values: { names: /.*Alice.*/ }, start: true, end: true }) }).click();
  await page.getByRole("button", { name: copy.loop.nudgeConfirm }).click();
  await expect(page.getByText(text(copy.loop.nudged, { count: "2" }))).toBeVisible();
  await expect.poll(reminderKeys, { timeout: 10_000 }).toHaveLength(4);
  expect(new Set(await reminderKeys()).size).toBe(4);
});

test("D10 · nobody is nudged once everyone has answered", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });

  // Everyone answers, so the dashboard says so and offers no nudge.
  for (const member of loop.members) {
    await rows("update memberships set accepted_at = now() where id = $1", [member.id]);
  }
  await rows(
    `insert into replies (issue_id, issue_question_id, membership_id, body, status, submitted_at)
     select $1, iq.id, m.id, 'Answered.', 'submitted', now()
     from issue_questions iq cross join memberships m
     where iq.issue_id = $1 and m.group_id = $2 and m.participation = 'contributor'`,
    [issue.issueId, loop.groupId],
  );

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(copy.loop.everyoneIn)).toBeVisible();
  await expect(page.getByRole("button", { name: copyPattern(copy.loop.nudgeNamed, { start: true }) })).toHaveCount(0);
});

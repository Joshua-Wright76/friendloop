import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D10 · the owner nudges whoever is still missing, and can do it again", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("Waiting on")).toBeVisible();
  await expect(page.locator(".person-pill", { hasText: "Alice" })).toBeVisible();

  // Both nudge rounds land on the same URL, so wait on the rows rather than the
  // address bar: the second click is still in flight while the page re-renders.
  const reminderKeys = async (): Promise<string[]> => {
    const sent = await rows<{ dedupe_key: string }>(
      "select dedupe_key from outbox where kind = 'reminder'",
    );
    return sent.map((row) => row.dedupe_key);
  };

  await page.getByRole("button", { name: /^Nudge .*Alice/ }).click();
  await page.getByRole("button", { name: "Send the nudge" }).click();
  await expect(page.getByText("3 nudges sent.")).toBeVisible();
  await expect.poll(reminderKeys).toHaveLength(3);
  expect(new Set(await reminderKeys()).size).toBe(3);

  // A second nudge is a second gentle email, not a duplicate row.
  await page.getByRole("button", { name: /^Nudge .*Alice.* again$/ }).click();
  await page.getByRole("button", { name: "Send the nudge" }).click();
  await expect(page.getByText("3 nudges sent.")).toBeVisible();
  await expect.poll(reminderKeys, { timeout: 10_000 }).toHaveLength(6);
  expect(new Set(await reminderKeys()).size).toBe(6);
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
  await expect(page.getByText("Everyone's in.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Nudge/ })).toHaveCount(0);
});

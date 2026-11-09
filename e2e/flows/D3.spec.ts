import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, clockHeaders, runSweep, sendNow, signIn } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D3 · send now sends the round as it stands and opens the next one", async ({ page }) => {
  const loop = await seedLoop();
  await runSweep(AFTER_FIRST_SLOT);
  const [round] = await rows<{ id: string }>("select id from issues where group_id = $1", [loop.groupId]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "The cat." }] });

  await signIn(page, "owner@friendloop.test");
  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));
  await page.goto(`/g/${loop.groupId}`);
  await sendNow(page);
  await expect(page.getByText(copyPattern(copy.rounds.sentNotice, { values: { number: "1", next: "2" } }))).toBeVisible();

  const rounds = await rows<{ number: number; status: string; delivers_at: Date }>(
    "select number, status, delivers_at from issues where group_id = $1 order by number",
    [loop.groupId],
  );
  expect(rounds.map((row) => [row.number, row.status])).toEqual([[1, "delivered"], [2, "open"]]);
  // Round 1 took the place of the 9 January delivery, so round 2 goes out the Friday after.
  expect(new Date(rounds[1].delivers_at).toISOString()).toBe("2026-01-16T08:00:00.000Z");

  const deliveries = await rows<{ count: number }>("select count(*)::int as count from outbox where kind = 'delivery'");
  expect(deliveries[0].count).toBe(3);

  // The Friday round 1 would have gone out passes without a second delivery.
  await runSweep(new Date("2026-01-09T08:05:00Z"));
  const after = await rows<{ count: number }>("select count(*)::int as count from issues where group_id = $1", [loop.groupId]);
  expect(after[0].count).toBe(2);
});

test("D3 · with nothing in the round, there is nothing to send", async ({ page }) => {
  const loop = await seedLoop();
  await runSweep(AFTER_FIRST_SLOT);
  await signIn(page, "owner@friendloop.test");
  await page.setExtraHTTPHeaders(clockHeaders(AFTER_FIRST_SLOT));

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(copy.loop.sendNowHint)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.loop.sendNow })).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DAY, DELIVERY_DAY, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D8 · nothing to send carries the round over, and the third empty delivery pauses the loop", async () => {
  const loop = await seedLoop();
  const seeded = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const issueRow = async () =>
    (await rows<{ status: string; delivers_at: string }>("select status, delivers_at from issues where id = $1", [seeded.issueId]))[0];

  expect((await runSweep(DELIVERY_DAY)).carried).toBe(1);
  expect(await issueRow()).toMatchObject({ status: "open" });
  expect(new Date((await issueRow()).delivers_at).toISOString()).toBe("2026-01-16T08:00:00.000Z");

  expect((await runSweep(new Date(DELIVERY_DAY.getTime() + 7 * DAY))).carried).toBe(1);
  const report = await runSweep(new Date(DELIVERY_DAY.getTime() + 14 * DAY));
  expect(report.skipped).toBe(1);
  expect((await issueRow()).status).toBe("skipped");

  const deliveries = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'delivery'",
  );
  expect(deliveries[0].count).toBe(0);

  const [group] = await rows<{ paused_at: string | null }>(
    "select paused_at from groups where id = $1",
    [loop.groupId],
  );
  expect(group.paused_at).not.toBeNull();

  const ownerNotices = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'nudge' and \"to\" = $1",
    ["owner@friendloop.test"],
  );
  expect(ownerNotices[0].count).toBe(1);
});

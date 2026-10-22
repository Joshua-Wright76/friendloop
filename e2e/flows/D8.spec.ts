import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D8 · nothing to send means no email, and the loop pauses itself", async () => {
  const loop = await seedLoop();
  const seeded = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  const report = await runSweep(DELIVERY_DAY);
  expect(report.skipped).toBe(1);

  const [issue] = await rows<{ status: string }>("select status from issues where id = $1", [seeded.issueId]);
  expect(issue.status).toBe("skipped");

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

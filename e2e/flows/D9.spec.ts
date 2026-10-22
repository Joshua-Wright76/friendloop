import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop, seedReplies } from "../support/seed";
import { runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D9 · stragglers get one nudge; people who answered get none", async () => {
  const loop = await seedLoop();
  const openedAt = new Date("2026-01-02T08:00:00Z");
  const issue = await seedOpenIssue(loop, { openedAt });

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Already answered." }],
  });

  const at = new Date(issue.deliversAt.getTime() - 24 * 60 * 60 * 1000);
  const report = await runSweep(at);
  expect(report.reminded).toBe(2);

  const reminded = await rows<{ to: string }>(
    "select \"to\" from outbox where kind = 'reminder' order by \"to\"",
  );
  expect(reminded.map((row) => row.to)).toEqual(["bob@friendloop.test", "owner@friendloop.test"]);

  const again = await runSweep(at);
  expect(again.reminded).toBe(0);
  const total = await rows<{ count: number }>(
    "select count(*)::int as count from outbox where kind = 'reminder'",
  );
  expect(total[0].count).toBe(2);
});

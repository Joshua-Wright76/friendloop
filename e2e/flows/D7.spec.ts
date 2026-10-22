import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D7 · delivery compiles the answers and emails everyone", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "The cat fist bump." }],
  });
  await seedReplies({
    issueId: issue.issueId,
    membershipId: bob.id,
    answers: [{ text: "What are you looking forward to?", body: "Friday." }],
  });

  const report = await runSweep(DELIVERY_DAY);
  expect(report.delivered).toBe(1);

  const [saved] = await rows<{ status: string }>("select status from issues where id = $1", [issue.issueId]);
  expect(saved.status).toBe("delivered");

  const deliveries = await rows<{ to: string; html: string }>(
    "select \"to\", html from outbox where kind = 'delivery' order by \"to\"",
  );
  expect(deliveries.map((row) => row.to)).toEqual([
    "alice@friendloop.test",
    "bob@friendloop.test",
    "owner@friendloop.test",
  ]);
  expect(deliveries[0].html).toContain("The cat fist bump.");
  expect(deliveries[0].html).toContain("Friday.");
  expect(deliveries[0].html).toContain("/i/");
});

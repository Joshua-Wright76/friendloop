import { test, expect } from "../support/test";
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

/**
 * Every member gets the same issue, but the link inside it is their own: the
 * delivery email is rewritten per recipient so opening it marks *them* as the
 * reader. Asserting only that the email exists would pass while every copy
 * carried the owner's credential.
 */
test("D7 · each delivery email carries that member's own link", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Something." }],
  });

  await runSweep(DELIVERY_DAY);

  const deliveries = await rows<{ to: string; html: string }>(
    "select \"to\", html from outbox where kind = 'delivery'",
  );
  expect(deliveries).toHaveLength(3);

  for (const row of deliveries) {
    const member = loop.members.find((candidate) => candidate.email === row.to)!;
    expect(row.html, `${row.to} should be addressed as themselves`).toContain(
      `/i/${issue.issueId}?m=${encodeURIComponent(member.token)}`,
    );
    for (const other of loop.members.filter((candidate) => candidate.token !== member.token)) {
      expect(row.html, `${row.to} must not carry ${other.email}'s token`).not.toContain(
        `?m=${encodeURIComponent(other.token)}`,
      );
    }
  }
});

/**
 * The same people can be in two loops. With the same answers table, the same
 * renderer, and one sweep, the cheapest bug in the world is a query that forgets
 * to filter by loop — and it leaks a private newsletter into someone else's.
 */
test("D7 · one loop's round never contains another loop's answers", async () => {
  const first = await seedLoop({ name: "First Loop" });
  const second = await seedLoop({ name: "Second Loop" });

  const firstIssue = await seedOpenIssue(first, { openedAt: AFTER_FIRST_SLOT });
  const secondIssue = await seedOpenIssue(second, { openedAt: AFTER_FIRST_SLOT });

  const firstAlice = first.members.find((member) => member.email.startsWith("alice"))!;
  const secondAlice = second.members.find((member) => member.email.startsWith("alice"))!;

  await seedReplies({
    issueId: firstIssue.issueId,
    membershipId: firstAlice.id,
    answers: [{ text: "What made you laugh this week?", body: "ONLY-IN-FIRST." }],
  });
  await seedReplies({
    issueId: secondIssue.issueId,
    membershipId: secondAlice.id,
    answers: [{ text: "What made you laugh this week?", body: "ONLY-IN-SECOND." }],
  });

  const report = await runSweep(DELIVERY_DAY);
  expect(report.delivered).toBe(2);

  const deliveries = await rows<{ group_id: string; html: string; subject: string }>(
    "select group_id, html, subject from outbox where kind = 'delivery'",
  );
  expect(deliveries).toHaveLength(6);

  for (const row of deliveries) {
    if (row.group_id === first.groupId) {
      expect(row.html).toContain("ONLY-IN-FIRST.");
      expect(row.html).not.toContain("ONLY-IN-SECOND.");
      expect(row.html).not.toContain("Second Loop");
    } else {
      expect(row.group_id).toBe(second.groupId);
      expect(row.html).toContain("ONLY-IN-SECOND.");
      expect(row.html).not.toContain("ONLY-IN-FIRST.");
      expect(row.html).not.toContain("First Loop");
    }
  }
});

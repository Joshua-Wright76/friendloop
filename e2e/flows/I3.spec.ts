import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue, seedReplies } from "../support/seed";
import { seedSuggestion } from "../support/suggestions";
import { runSweep } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("I3 · a delivered issue credits named suggestions, not anonymous ones", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Alice's named suggestion and Bob's anonymous one are already in the pool.
  await seedSuggestion({ loop, questionText: "What made you laugh this week?", memberEmail: alice.email });
  await seedSuggestion({
    loop,
    questionText: "What are you looking forward to?",
    memberEmail: bob.email,
    authorDisplay: "anonymous",
  });

  // The sweep snapshots both credits at the moment the issue opens.
  await runSweep(new Date("2026-01-02T08:00:00Z"));

  const snapshot = await rows<{ text: string; suggested_by: string | null }>(
    "select text, suggested_by from issue_questions order by position",
  );
  expect(snapshot.map((row) => [row.text, row.suggested_by])).toEqual([
    ["What made you laugh this week?", "Alice"],
    ["What are you looking forward to?", null],
  ]);

  // This loop's first issue — the delivery sweep also opens the next one, so
  // target by number, not by recency.
  const [first] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await seedReplies({
    issueId: first.id,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "The cat fist bump." }],
  });

  const report = await runSweep(new Date("2026-01-09T08:00:00Z"));
  expect(report.delivered).toBe(1);

  await page.goto(`/i/${first.id}?m=${alice.token}`);
  await expect(page.getByText(copyText(copy.issue.askedBy, { name: "Alice" }))).toBeVisible();
});

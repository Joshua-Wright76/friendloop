import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { seedPoll } from "../support/polls";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, latestOutboxBody, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("L3 · a delivered poll shows every pick by name beside a quiet tally, to members and share links alike", async ({ page, request }) => {
  const loop = await seedLoop({ questions: ["What made you laugh this week?"] });
  await seedPoll(loop, { text: "Which weekends work?", options: ["June", "July", "August"], multiple: true });
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT);

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const [{ id: issueId }] = await rows<{ id: string }>("select id from issues limit 1");
  const [{ id: pollId }] = await rows<{ id: string }>("select id from issue_questions where kind = 'poll'");

  for (const [member, choices] of [[alice, [0, 2]], [bob, [2]]] as const) {
    const vote = await request.post(`/api/reply/${member.token}`, {
      data: { action: "pollChoice", issueQuestionId: pollId, choices },
    });
    expect(vote.status()).toBe(200);
    expect((await request.post(`/api/reply/${member.token}`, { data: { action: "submit" } })).status()).toBe(200);
  }

  const delivery = await runSweep(DELIVERY_DAY);
  expect(delivery.delivered).toBe(1);

  // Members see each person's pick next to their name, and the tally.
  await page.goto(`/i/${issueId}?m=${alice.token}`);
  const question = page.locator("section").filter({ hasText: "Which weekends work?" });
  await expect(question.getByText("Results · 2 votes")).toBeVisible();
  const results = question.getByRole("list", { name: "Results" });
  await expect(results.locator("li").nth(0)).toContainText("June");
  await expect(results.locator("li").nth(0)).toContainText("1");
  await expect(results.locator("li").nth(1)).toContainText("0");
  await expect(results.locator("li").nth(2)).toContainText("2");

  const aliceCard = question.locator("article").filter({ hasText: "You" });
  await expect(aliceCard.getByRole("list", { name: "Chose June, August" })).toBeVisible();
  const bobCard = question.locator("article").filter({ hasText: "Bob" });
  await expect(bobCard.getByRole("list", { name: "Chose August" })).toBeVisible();

  // Share-link visitors see the same, without being able to react.
  const [{ share_token: shareToken }] = await rows<{ share_token: string }>(
    "select share_token from issues where id = $1",
    [issueId],
  );
  await page.goto(`/s/${shareToken}`);
  const shared = page.locator("section").filter({ hasText: "Which weekends work?" });
  await expect(shared.getByText("Results · 2 votes")).toBeVisible();
  await expect(shared.getByRole("list", { name: "Chose June, August" })).toBeVisible();
  await expect(shared.getByText("Alice", { exact: true })).toBeVisible();

  // The email says the same in words.
  const email = await latestOutboxBody("delivery:");
  expect(email).toContain("Chose: June, August");
  expect(email).toContain("Results: June: 1 · July: 0 · August: 2");
});

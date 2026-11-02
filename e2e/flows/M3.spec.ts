import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedConversation } from "../support/comments";

test.beforeEach(async () => {
  await resetDatabase();
});

test("M3 · a comment on one answer renders with that answer and never in the issue-level thread", async ({ page }) => {
  const { issue, alice, bob } = await seedConversation();
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);

  const bobsAnswer = page.locator("article").filter({ hasText: "Bob rebuilt the shed." });
  await bobsAnswer.getByRole("button", { name: "Comment", exact: true }).click();

  const composer = bobsAnswer.getByLabel("Comment on Bob's answer");
  await composer.fill("Was it a big shed?");
  await bobsAnswer.getByRole("button", { name: "Post", exact: true }).click();

  // It shows up under Bob's answer, and the toggle now counts it.
  await expect(bobsAnswer.getByText("Was it a big shed?")).toBeVisible();
  await expect(bobsAnswer.getByRole("button", { name: "1 comment" })).toBeVisible();

  // The issue-level thread is still empty, and Alice's own answer has nothing.
  const thread = page.locator("section").filter({ has: page.getByRole("heading", { name: "Comments" }) });
  await expect(thread.getByText("Nothing yet.")).toBeVisible();
  await expect(thread.getByText("Was it a big shed?")).toHaveCount(0);
  const alicesAnswer = page.locator("article").filter({ hasText: "Alice found a very patient goose." });
  await expect(alicesAnswer.getByRole("button", { name: "Comment", exact: true })).toBeVisible();

  const [saved] = await rows<{ reply_id: string; membership_id: string }>("select reply_id, membership_id from comments");
  const [bobReply] = await rows<{ id: string }>("select id from replies where membership_id = $1", [bob.id]);
  expect(saved).toEqual({ reply_id: bobReply.id, membership_id: alice.id });

  // Bob sees it on his own answer ("your answer"), in his own session.
  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  const mine = page.locator("article").filter({ hasText: "Bob rebuilt the shed." });
  await mine.getByRole("button", { name: "1 comment" }).click();
  await expect(mine.getByText("Was it a big shed?")).toBeVisible();
  await expect(mine.getByLabel("Comment on your answer")).toBeVisible();
});

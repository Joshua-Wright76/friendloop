import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E2 · a share link shows the round to a stranger, read-only", async ({ page }) => {
  const loop = await seedLoop();
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);

  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Shared with the internet." }],
    shareToken: "share-token-abc123",
  });

  await page.goto(`/s/${issue && "share-token-abc123"}`);

  await expect(page.getByRole("heading", { name: text(copy.share.round, { number: 1 }) })).toBeVisible();
  await expect(page.getByText("Shared with the internet.")).toBeVisible();
  await expect(page.getByLabel(copy.issue.commentAriaLabel)).toHaveCount(0);
  await expect(page.getByRole("button", { name: copy.issue.post })).toHaveCount(0);
});

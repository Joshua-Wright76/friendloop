import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { openPart, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F6 · resetting share links retires every URL that was handed out", async ({ page }) => {
  const loop = await seedLoop();
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Still here after the reset." }],
    shareToken: "old-share-token",
  });

  await page.goto("/s/old-share-token");
  await expect(page.getByText("Still here after the reset.")).toBeVisible();

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await openPart(page, "Reset and delete");
  await page.getByRole("button", { name: "Reset share links" }).click();
  await page.getByRole("button", { name: "Yes, reset share links" }).click(); // resetting asks first
  await expect(page.getByText("New share links. Old ones no longer work.")).toBeVisible();

  await page.goto("/s/old-share-token");
  await expect(page.getByText("This shared round isn't available")).toBeVisible();

  const [row] = await rows<{ share_token: string }>(
    "select share_token from issues where id = $1",
    [issue.issueId],
  );
  expect(row.share_token).not.toBe("old-share-token");

  await page.goto(`/s/${row.share_token}`);
  await expect(page.getByText("Still here after the reset.")).toBeVisible();
});

test("F6 · turning sharing off closes links that already exist", async ({ page }) => {
  const loop = await seedLoop();
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Private again." }],
    shareToken: "live-share-token",
  });

  await rows("update groups set share_enabled = false where id = $1", [loop.groupId]);
  await page.goto("/s/live-share-token");
  await expect(page.getByText("Private again.")).toHaveCount(0);
  await expect(page.getByText("This shared round isn't available")).toBeVisible();
});

import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedConversation, TINY_PNG } from "../support/comments";

test.beforeEach(async () => {
  await resetDatabase();
});

test("M4 · replying quotes the comment into the composer, and a comment carries one photo", async ({ page }) => {
  const { issue, alice, bob } = await seedConversation();
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Anyone fancy a trip to the coast?')", [
    issue.issueId,
    bob.id,
  ]);

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await page.getByRole("button", { name: "Reply to Bob" }).click();

  await expect(page.getByText("Replying to Bob")).toBeVisible();
  const box = page.getByLabel("Comment", { exact: true });
  await expect(box).toBeFocused();
  await box.fill("Yes, and I'll bring the snacks.");

  await page.getByLabel("Comment", { exact: true }).locator("xpath=ancestor::form").locator('input[type="file"]').setInputFiles({
    name: "beach.png",
    mimeType: "image/png",
    buffer: TINY_PNG,
  });
  await expect(page.getByText("Photo: beach.png")).toBeVisible();
  await page.getByRole("button", { name: "Post", exact: true }).click();

  // The new comment shows the quote above it, and the photo below.
  await expect(page.locator("blockquote")).toContainText("Bob wrote");
  await expect(page.locator("blockquote")).toContainText("Anyone fancy a trip to the coast?");
  await expect(page.getByRole("img", { name: /Photo from .* comment/ })).toBeVisible();
  await expect(page.locator("p", { hasText: "Yes, and I'll bring the snacks." })).toBeVisible();
  await expect(page.getByText("Replying to Bob")).toHaveCount(0);

  const [saved] = await rows<{ quote_comment_id: string | null; photo_url: string | null }>(
    "select quote_comment_id, photo_url from comments where membership_id = $1",
    [alice.id],
  );
  expect(saved.quote_comment_id).not.toBeNull();
  expect(saved.photo_url).toMatch(/\/uploads\/[a-f0-9]{64}\.png$/);
});

test("M4 · a photo that can't be read is turned away plainly, a quote can be cancelled, and a removed quote reads as removed", async ({ page }) => {
  const { issue, alice, bob } = await seedConversation();
  const [quoted] = await rows<{ id: string }>(
    "insert into comments (issue_id, membership_id, body) values ($1, $2, 'Said, then unsaid.') returning id",
    [issue.issueId, bob.id],
  );
  await rows("insert into comments (issue_id, membership_id, body, quote_comment_id) values ($1, $2, 'Agreed!', $3)", [
    issue.issueId,
    alice.id,
    quoted.id,
  ]);
  await rows("update comments set deleted_at = now() where id = $1", [quoted.id]);

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await expect(page.getByText("Said, then unsaid.")).toHaveCount(0);
  await expect(page.locator("blockquote")).toContainText("A comment that has since been removed.");
  await expect(page.getByText("Agreed!")).toBeVisible();

  const file = page.locator('input[type="file"]');
  // Bytes that cannot be read as a picture are turned away plainly (a real big photo is shrunk: see T1).
  await file.setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
  await expect(page.locator("p[role=alert]")).toContainText("We couldn't read that photo.");
  await expect(page.getByText("Photo: huge.png")).toHaveCount(0);

  await file.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("p[role=alert]")).toContainText("We couldn't read that photo.");

  // Choose a photo, then change your mind.
  await file.setInputFiles({ name: "beach.png", mimeType: "image/png", buffer: TINY_PNG });
  await page.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByText("Photo: beach.png")).toHaveCount(0);

  // And quoting can be cancelled before posting.
  await page.getByRole("button", { name: "Reply to You" }).click();
  await expect(page.getByText("Replying to You")).toBeVisible();
  await page.getByRole("button", { name: "Cancel reply" }).click();
  await expect(page.getByText("Replying to You")).toHaveCount(0);
});

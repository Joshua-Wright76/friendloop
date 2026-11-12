import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { signIn } from "../support/harness";
import { seedConversation } from "../support/comments";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("M2 · with commenting off every comment surface disappears and writes are refused; turning it back on restores them", async ({ page, request }) => {
  const { loop, issue, alice, bob } = await seedConversation();
  const [bobReply] = await rows<{ id: string }>("select id from replies where membership_id = $1", [bob.id]);
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, 'Already said.')", [issue.issueId, bob.id]);
  await rows("insert into comments (issue_id, membership_id, reply_id, body) values ($1, $2, $3, 'On the answer.')", [
    issue.issueId,
    alice.id,
    bobReply.id,
  ]);

  // On: the thread, the box, and the answer's own "1 comment" are all there.
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await expect(page.getByRole("heading", { name: copy.print.commentsHeading })).toBeVisible();
  await expect(page.getByText("Already said.")).toBeVisible();
  await expect(page.getByRole("button", { name: copy.issue.commentCountOne })).toBeVisible();

  // The owner turns it off.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await page.getByLabel(copy.settings.comments).uncheck();
  // Details save as you go.
  await expect(page.getByText(copy.stationery.statusSaved)).toBeVisible();

  // Off: nothing to read, nothing to write, for anyone.
  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await expect(page.getByText("Alice found a very patient goose.")).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.print.commentsHeading })).toHaveCount(0);
  await expect(page.getByLabel(copy.issue.commentAriaLabel, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Already said.")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /comment/i })).toHaveCount(0);

  const refused = await request.post(`/api/issue/${issue.issueId}/comments`, {
    multipart: { viewerToken: alice.token, body: "Sneaking one in." },
  });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: copy.issue.errors.commentsOff });
  expect(await rows("select 1 from comments")).toHaveLength(2);

  // Back on: everything that was written is still there.
  await page.goto(`/g/${loop.groupId}/settings`);
  await page.getByLabel(copy.settings.comments).check();
  // Details save as you go.
  await expect(page.getByText(copy.stationery.statusSaved)).toBeVisible();

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await expect(page.getByText("Already said.")).toBeVisible();
  await expect(page.getByRole("button", { name: copy.issue.commentCountOne })).toBeVisible();
});

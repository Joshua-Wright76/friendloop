import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedConversation } from "../support/comments";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("M1 · typing @ offers member names; the mentioned member gets exactly one email, readers included", async ({ page }) => {
  const { issue, alice, bob } = await seedConversation({ readers: ["bob@friendloop.test"] });

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  const box = page.getByLabel(copy.issue.commentAriaLabel, { exact: true });
  await box.click();
  await box.pressSequentially("Loved this, @bo");

  // The list is a real listbox, reachable without a pointer.
  const list = page.getByRole("listbox", { name: copy.issue.mentionListLabel });
  await expect(list).toBeVisible();
  await expect(list.getByRole("option")).toHaveCount(1);
  await expect(box).toHaveAttribute("aria-activedescendant", /.+/);
  await box.press("Enter");
  await expect(list).toHaveCount(0);
  await expect(box).toHaveValue("Loved this, @Bob ");

  await box.pressSequentially("see you soon");
  await page.getByRole("button", { name: copy.issue.post, exact: true }).click();

  // Rendered as a name, not as the stored reference.
  const posted = page.locator("p", { hasText: "Loved this," });
  await expect(posted).toBeVisible();
  await expect(posted.locator(".mention")).toHaveText("@Bob");
  await expect(posted).not.toContainText("@[");

  const [comment] = await rows<{ body: string }>("select body from comments");
  expect(comment.body).toBe(`Loved this, @[${bob.id}] see you soon`);

  const mail = await rows<{ to: string; subject: string; html: string }>(
    "select \"to\", subject, html from outbox where kind = 'mention'",
  );
  expect(mail).toHaveLength(1);
  expect(mail[0].to).toBe("bob@friendloop.test");
  expect(mail[0].subject).toBe(text(copy.emails.mention.subject, { authorName: "Alice", groupName: "Friday Loop" }));
  expect(mail[0].html).toContain(`/i/${issue.issueId}?m=${bob.token}`);

  // Reloading, or opening the page again, never sends it a second time.
  await page.reload();
  await expect(posted).toBeVisible();
  expect(await rows("select 1 from outbox where kind = 'mention'")).toHaveLength(1);

  // The link in the email opens the issue for the reader, who can read but not reply.
  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  await expect(page.locator(".mention").first()).toHaveText("@Bob");
});

test("M1 · the list works by tapping too, and a mention that was deleted from the text sends nothing", async ({ page }) => {
  const { issue, alice } = await seedConversation();

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  const box = page.getByLabel(copy.issue.commentAriaLabel, { exact: true });
  await box.click();
  await box.pressSequentially("@");
  const list = page.getByRole("listbox", { name: copy.issue.mentionListLabel });
  await expect(list.getByRole("option")).toHaveCount(2);

  await list.getByRole("option", { name: "Sam" }).click();
  await expect(box).toHaveValue("@Sam ");

  // Escape closes the list without choosing.
  await box.pressSequentially("and @b");
  await expect(list).toBeVisible();
  await box.press("Escape");
  await expect(list).toHaveCount(0);

  // Take the first mention back out of the text before posting.
  await box.fill("Never mind, just thanks.");
  await page.getByRole("button", { name: copy.issue.post, exact: true }).click();
  await expect(page.getByText("Never mind, just thanks.")).toBeVisible();

  expect(await rows("select 1 from outbox where kind = 'mention'")).toHaveLength(0);
});

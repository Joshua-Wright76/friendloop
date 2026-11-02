import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E3 · a member can comment and it sticks", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await page.getByLabel("Comment", { exact: true }).fill("This made my morning.");
  await page.getByRole("button", { name: "Post" }).click();

  // The thread, not the box: the typed text is still in the textarea until the post lands.
  await expect(page.locator("p", { hasText: "This made my morning." })).toBeVisible();

  const saved = await rows<{ body: string }>("select body from comments");
  expect(saved).toHaveLength(1);
  expect(saved[0].body).toBe("This made my morning.");
});

/**
 * Two people, two sessions. Everything else in this suite reads the page through
 * one browser, which cannot see a stale render, a cache that was never
 * invalidated, or a comment only its author can see.
 */
test("E3 · a comment posted in one session is there for another person", async ({ browser }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth commenting on." }],
  });

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    await signIn(alicePage, "alice@friendloop.test");
    await signIn(bobPage, "bob@friendloop.test");

    await alicePage.goto(`/i/${issue.issueId}`);
    await alicePage.getByLabel("Comment", { exact: true }).fill("Left by Alice, for Bob to read.");
    await alicePage.getByRole("button", { name: "Post" }).click();
    await expect(alicePage.locator("p", { hasText: "Left by Alice, for Bob to read." })).toBeVisible();

    await bobPage.goto(`/i/${issue.issueId}`);
    await expect(bobPage.getByText("Left by Alice, for Bob to read.")).toBeVisible();
    await expect(bobPage.getByText("Alice").first()).toBeVisible();

    // And the author is not mistaken for the reader.
    await expect(alicePage.getByText("You").first()).toBeVisible();
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

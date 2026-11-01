import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("E4 · reacting toggles on and off", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a heart." }],
  });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await page.goto(`/i/${issue.issueId}?m=${bob.token}`);
  const heart = page.getByRole("button", { name: /React with ❤️/ }).first();
  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "true");

  const after = await rows<{ count: number }>("select count(*)::int as count from reactions");
  expect(after[0].count).toBe(1);

  await heart.click();
  await expect(heart).toHaveAttribute("aria-pressed", "false");
  const cleared = await rows<{ count: number }>("select count(*)::int as count from reactions");
  expect(cleared[0].count).toBe(0);
});

test("E4 · a reaction reaches the person whose answer it is", async ({ browser }) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: new Date("2026-10-30T08:00:00Z"),
    answers: [{ email: "alice@friendloop.test", body: "Something worth a heart." }],
  });

  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  try {
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();
    await signIn(alicePage, "alice@friendloop.test");
    await signIn(bobPage, "bob@friendloop.test");

    await alicePage.goto(`/i/${issue.issueId}`);
    const aliceHeart = alicePage.getByRole("button", { name: /React with ❤️/ }).first();
    await expect(aliceHeart).toHaveAttribute("aria-pressed", "false");

    await bobPage.goto(`/i/${issue.issueId}`);
    await bobPage.getByRole("button", { name: /React with ❤️/ }).first().click();

    await alicePage.reload();
    const after = alicePage.getByRole("button", { name: /React with ❤️/ }).first();
    await expect(after).toContainText("1");
    await expect(after, "the count is not the viewer's own reaction").toHaveAttribute(
      "aria-pressed",
      "false",
    );
  } finally {
    await aliceContext.close();
    await bobContext.close();
  }
});

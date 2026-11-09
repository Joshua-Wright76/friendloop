import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B4 · an invited contributor lands on the questions with no sign-in", async ({ page }) => {
  const loop = await seedLoop({ owner: { email: "owner@friendloop.test", name: "Sam" } });
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);

  await expect(page.getByText("Friday Loop").first()).toBeVisible();
  await expect(page.getByText(copy.questionPacks[0].questions[0])).toBeVisible();
  await expect(page.getByLabel(copy.questionPacks[0].questions[0])).toBeVisible();
  await expect(page.getByText(/Alice, only the people in Friday Loop/)).toBeVisible();
  await expect(page.getByRole("button", { name: copy.signIn.submit })).toHaveCount(0);
});

test("B4 · a reader gets the loop but no form", async ({ page }) => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "bob@friendloop.test", name: "Bob", participation: "reader" },
    ],
  });
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await page.goto(`/r/${bob.token}`);

  await expect(page.getByRole("heading", { name: /reader/i })).toBeVisible();
  await expect(page.locator("textarea")).toHaveCount(0);
});

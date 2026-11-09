import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { signIn, unfold } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("I1 · a contributor suggests a question from the reply sheet", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await page.getByRole("link", { name: copy.reply.suggestLink }).click();
  await expect(page).toHaveURL(`/r/${alice.token}/suggest`);

  await page.getByLabel(copy.suggest.fieldLabel).fill("Who taught the dog to open doors?");
  await page.getByRole("radio", { name: copy.suggest.creditName }).check();
  await page.getByRole("button", { name: copy.suggest.submit }).click();

  await expect(page.getByText(copy.suggest.doneTitle)).toBeVisible();

  // Web-only by design: no email leaves the building for a suggestion.
  const outbox = await rows<{ count: number }>("select count(*)::int as count from outbox");
  expect(outbox[0].count).toBe(0);

  // The owner's queue already shows it, attributed.
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await unfold(page, copy.questions.suggestionsNoticeOne);
  await expect(page.getByRole("textbox", { name: copy.questions.suggestionTextLabel })).toHaveValue(
    "Who taught the dog to open doors?",
  );
  await expect(page.getByText("from Alice")).toBeVisible();
  expect(issue.deliversAt).toBeTruthy();
});

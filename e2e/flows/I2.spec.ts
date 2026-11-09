import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { seedSuggestion } from "../support/suggestions";
import { signIn, unfold } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("I2 · the owner accepts with an edit, or turns a suggestion down", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: new Date("2026-01-02T08:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Two pending suggestions: one through the UI, one as a fixture.
  await page.goto(`/r/${alice.token}/suggest`);
  await page.getByLabel(copy.suggest.fieldLabel).fill("Who taught the dog to open doors?");
  await page.getByRole("button", { name: copy.suggest.submit }).click();
  await expect(page.getByText(copy.suggest.doneTitle)).toBeVisible();

  await seedSuggestion({
    loop,
    questionText: "What are you reading right now?",
    memberEmail: bob.email,
    authorDisplay: "anonymous",
    status: "pending",
  });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);

  await unfold(page, text(copy.questions.suggestionsNotice, { count: "2" }));
  // The anonymous suggestion shows its chip, but the owner still sees who asked.
  await expect(page.getByText("from Bob")).toBeVisible();
  await expect(page.getByText(copy.questions.suggestionAnonymous)).toBeVisible();

  // Accept Alice's with a small edit: the edited text joins the pool.
  const field = page.getByRole("textbox", { name: copyPattern(copy.questions.suggestionTextLabel, { start: true }) }).first();
  await field.fill("Who taught the dog to open doors, and when?");
  await page.getByRole("button", { name: copy.questions.addToPool }).first().click();

  await expect(page.getByText(copy.questions.suggestionAddedNotice)).toBeVisible();
  await expect(page.getByText("Who taught the dog to open doors, and when?").first()).toBeVisible();

  // Decline what is left: the queue empties out.
  await page.getByRole("button", { name: copy.questions.suggestionDecline }).click();
  await expect(page.getByText(copy.questions.suggestionDeclinedNotice)).toBeVisible();
  await expect(page.getByText(/suggested by/)).toHaveCount(0);
});

import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { seedSuggestion } from "../support/suggestions";
import { signIn, unfold } from "../support/harness";

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
  await page.getByLabel("Your question").fill("Who taught the dog to open doors?");
  await page.getByRole("button", { name: "Send suggestion" }).click();
  await expect(page.getByText("Suggestion sent")).toBeVisible();

  await seedSuggestion({
    loop,
    questionText: "What are you reading right now?",
    memberEmail: bob.email,
    authorDisplay: "anonymous",
    status: "pending",
  });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);

  await unfold(page, "2 suggested by members");
  // The anonymous suggestion shows its chip, but the owner still sees who asked.
  await expect(page.getByText("from Bob")).toBeVisible();
  await expect(page.getByText("anonymous")).toBeVisible();

  // Accept Alice's with a small edit: the edited text joins the pool.
  const field = page.getByRole("textbox", { name: /^Suggested question/ }).first();
  await field.fill("Who taught the dog to open doors, and when?");
  await page.getByRole("button", { name: "Add to pool" }).first().click();

  await expect(page.getByText("Suggestion added to the pool.")).toBeVisible();
  await expect(page.getByText("Who taught the dog to open doors, and when?").first()).toBeVisible();

  // Decline what is left: the queue empties out.
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText("Suggestion declined.")).toBeVisible();
  await expect(page.getByText(/suggested by/)).toHaveCount(0);
});

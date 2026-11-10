import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D6 · an answer changes in place, and clearing it takes it out of the round", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const answer = page.getByLabel(copy.questionPacks[0].questions[0]);
  await answer.fill("First version.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();
  await expect(page.locator(".sent-stamp:visible")).toHaveClass(/sent-stamp-animate/);

  await page.getByRole("button", { name: copy.reply.confirmation.edit }).click();
  await answer.fill("Second version, with the good detail.");
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedInRound);

  // Rewriting must not add a second row, and a question left empty gets none.
  const saved = async () => rows<{ body: string }>(
    "select body from replies where issue_id = $1 and membership_id = $2",
    [issue.issueId, alice.id],
  );
  await expect.poll(async () => (await saved()).map((row) => row.body)).toEqual(["Second version, with the good detail."]);

  // Cleared, it isn't an answer any more: not in the round, not in the count.
  await answer.fill("");
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedAsYouGo);
  await expect.poll(async () => (await saved()).map((row) => row.body)).toEqual([""]);
  await expect(page.getByText(copyPattern(copy.reply.answered, { values: { answered: "0", total: "2" }, flags: "i" })).first()).toBeVisible();
  const view = await page.request.get(`/i/${issue.issueId}?m=${alice.token}`);
  expect(await view.text()).not.toContain("Second version");
});

test("D6 · clearing an answer resolves the overall save status after an older write is discarded", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  let delayedBody: string | null = null;

  await page.route("**/api/reply/**", async (route) => {
    const payload = route.request().postDataJSON() as { action: string; body?: string };
    if (payload.action === "draft" && payload.body === "An answer that gets cleared.") {
      delayedBody = payload.body;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    await route.fulfill({ json: { ok: true, savedAt: new Date().toISOString() } });
  });

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const answer = page.getByLabel(copy.questionPacks[0].questions[0]);
  await answer.fill("An answer that gets cleared.");
  await expect.poll(() => delayedBody).toBe("An answer that gets cleared.");
  await answer.fill("");

  // The late, slower write for the text you deleted is discarded, so the status
  // settles instead of being stuck on "Saving…".
  await expect(page.locator("[data-save-status]")).not.toHaveText(/Saving/);
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedAsYouGo);

  // With nothing left, Done stays operable and points at the first question.
  const done = page.getByRole("button", { name: copy.reply.done, exact: true });
  await expect(done).not.toHaveAttribute("aria-disabled", "true");
  await done.click();
  await expect(page.getByRole("alert").filter({ hasText: copy.reply.nothingWritten })).toBeVisible();
  await expect(answer).toBeFocused();
});

import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D6 · a submitted answer can still be rewritten, not duplicated", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const answer = page.getByLabel("What made you laugh this week?");
  await answer.fill("First version.");
  await page.getByRole("button", { name: "Send answers" }).click();
  await expect(page.getByRole("heading", { name: "Sent", exact: true })).toBeVisible();
  await expect(page.locator(".sent-stamp:visible")).toHaveClass(/sent-stamp-animate/);

  await page.getByRole("button", { name: "Edit my answers" }).click();
  await answer.fill("Second version, with the good detail.");
  await page.getByRole("button", { name: "Save changes" }).click();
  // A second send confirms again, as a change rather than a first send.
  await expect(page.getByRole("heading", { name: "Changes sent", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit my answers" }).click();
  // The overall save status, which several parts of the sheet label "Saved".
  await expect(page.locator("[data-save-status]")).toHaveText("Saved");

  // Coming back later opens the sheet itself, with its quiet "Sent" note.
  await page.reload();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
  await expect(page.locator(".sent-stamp:visible")).not.toHaveClass(/sent-stamp-animate/);
  await expect(page.getByLabel("What made you laugh this week?")).toHaveValue(
    "Second version, with the good detail.",
  );

  // Sending writes one draft per question in the round, so the round's two
  // questions mean two rows — and rewriting one answer must not add a third.
  const saved = await rows<{ body: string; status: string }>(
    `select body, status from replies where issue_id = $1 and membership_id = $2`,
    [issue.issueId, alice.id],
  );
  expect(saved, "one row per question, updated in place").toHaveLength(2);
  const answered = saved.filter((row) => row.body.length > 0);
  expect(answered, "the edited answer was updated in place").toHaveLength(1);
  expect(answered[0].body).toBe("Second version, with the good detail.");
  expect(answered[0].status).toBe("submitted");
});

test("D6 · clearing a draft resolves the overall save status after an older write is discarded", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  let delayedBody: string | null = null;

  await page.route("**/api/reply/**", async (route) => {
    const payload = route.request().postDataJSON() as { action: string; body?: string };
    if (payload.action === "draft" && payload.body === "A draft that gets cleared.") {
      delayedBody = payload.body;
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    await route.fulfill({ json: { ok: true, savedAt: new Date().toISOString() } });
  });

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const answer = page.getByLabel("What made you laugh this week?");
  await answer.fill("A draft that gets cleared.");
  await expect.poll(() => delayedBody).toBe("A draft that gets cleared.");
  await answer.fill("");

  // With nothing left to send, Send stays operable and points at the first question.
  const send = page.getByRole("button", { name: "Send answers" });
  await expect(send).toBeEnabled();
  await expect(send).not.toHaveAttribute("aria-disabled", "true");
  // The late, slower write for the text you deleted is discarded, so the status
  // settles instead of being stuck on "Saving…".
  await expect(page.locator("[data-save-status]")).not.toHaveText(/Saving/);
  await expect(page.locator("[data-save-status]")).toHaveText("");

  await send.click();
  await expect(page.getByRole("alert").filter({ hasText: "Write one answer to send. The rest can wait." })).toBeVisible();
  await expect(answer).toBeFocused();
});

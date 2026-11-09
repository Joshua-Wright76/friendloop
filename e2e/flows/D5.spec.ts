import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, signIn, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("D5 · Done confirms what goes out and when", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("A cat fist bump.");
  await expect(page.locator("[data-save-status]")).toHaveText("Saved. It goes out with the round.");

  // Typed and straight to Done: the last words still land before the confirmation.
  await page.getByLabel("What are you looking forward to?").fill("Friday, obviously.");
  await page.getByRole("button", { name: "Done", exact: true }).click();

  // A screen of its own, with focus on it, and the sheet steps aside.
  const heading = page.getByRole("heading", { name: "All set", exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  // It repeats the real deadline, computed on the server, and the reader's own
  // time when their zone differs from the loop's, as the sheet does.
  await expect(
    page.getByText(/^Everything you wrote for Round 1 goes out on (.+ your time \()?Fri 9 Jan, 9:05 AM( in Amsterdam\))?\.$/),
  ).toBeVisible();
  await expect(page.getByText("You can change anything until then.")).toBeVisible();
  await expect(page.getByLabel("What made you laugh this week?")).toBeHidden();
  // Nobody is signed in here, so there is no loop page to offer.
  await expect(page.getByRole("link", { name: /^Go to / })).toHaveCount(0);

  // "Back to my answers" brings the sheet back, answers intact, ready to change.
  await page.getByRole("button", { name: "Back to my answers" }).click();
  await expect(page.getByLabel("What made you laugh this week?")).toHaveValue("A cat fist bump.");

  // A later visit opens the sheet itself, with everything still there.
  await page.reload();
  await expect(page.getByLabel("What are you looking forward to?")).toHaveValue("Friday, obviously.");
  await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
});

test("D5 · the owner counts an answer as soon as it saves, before any Done", async ({ page }, testInfo) => {
  // The dashboard is not a phone surface in this suite (see playwright.config.ts).
  test.skip(testInfo.project.name === "phone", "owner dashboard runs on desktop");
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  // Signed in on the real clock: a session minted on a frozen one would already
  // have expired in the browser. The sheet itself is reached by Alice's link.
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("0 of 3 people in")).toBeVisible();

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("A cat fist bump.");
  await expect(page.locator("[data-save-status]")).toHaveText("Saved. It goes out with the round.");

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("1 of 3 people in")).toBeVisible();
});

test("D5 · someone signed in on their own link can go on to the loop", async ({ page }, testInfo) => {
  // The loop page is not a phone surface in this suite (see playwright.config.ts).
  test.skip(testInfo.project.name === "phone", "loop page runs on desktop");
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  // Signed in on the real clock, as above.
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);

  // Someone else's link, even opened while signed in, offers no way into the loop.
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("Not mine to write.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Go to / })).toHaveCount(0);

  // Their own link does, and it lands on the loop.
  await page.goto(`/r/${loop.ownerToken}`);
  await waitForSheet(page);
  await page.getByLabel("What made you laugh this week?").fill("My own words.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All set", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Go to / }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));
});

test("D5 · Done with nothing written points at the first question", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const done = page.getByRole("button", { name: "Done", exact: true });
  await expect(done).not.toHaveAttribute("aria-disabled", "true");
  await done.click();
  await expect(page.getByRole("alert").filter({ hasText: "Nothing written yet." })).toBeVisible();
  await expect(page.getByLabel("What made you laugh this week?")).toBeFocused();
  await expect(page.getByRole("heading", { name: "All set" })).toHaveCount(0);
});

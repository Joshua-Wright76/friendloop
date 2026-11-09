import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, signIn, waitForSheet } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

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
  await page.getByLabel(copy.questionPacks[0].questions[0]).fill("A cat fist bump.");
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedInRound);

  // Typed and straight to Done: the last words still land before the confirmation.
  await page.getByLabel(copy.questionPacks[0].questions[1]).fill("Friday, obviously.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();

  // A screen of its own, with focus on it, and the sheet steps aside.
  const heading = page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  // It repeats the real deadline, computed on the server, and the reader's own
  // time when their zone differs from the loop's, as the sheet does.
  await expect(
    page.getByText(copyPattern(copy.reply.confirmation.body, { values: { round: text(copy.reply.round, { number: 1 }), deadline: /on (.+ your time \()?Fri 9 Jan, 9:05 AM( in Amsterdam\))?/ }, start: true, end: true })),
  ).toBeVisible();
  await expect(page.getByText(copy.reply.confirmation.change)).toBeVisible();
  await expect(page.getByLabel(copy.questionPacks[0].questions[0])).toBeHidden();
  // Nobody is signed in here, so there is no loop page to offer.
  await expect(page.getByRole("link", { name: copyPattern(copy.reply.confirmation.loop, { start: true }) })).toHaveCount(0);

  // "Back to my answers" brings the sheet back, answers intact, ready to change.
  await page.getByRole("button", { name: copy.reply.confirmation.edit }).click();
  await expect(page.getByLabel(copy.questionPacks[0].questions[0])).toHaveValue("A cat fist bump.");

  // A later visit opens the sheet itself, with everything still there.
  await page.reload();
  await expect(page.getByLabel(copy.questionPacks[0].questions[1])).toHaveValue("Friday, obviously.");
  await expect(page.getByRole("button", { name: copy.reply.done, exact: true })).toBeVisible();
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
  await expect(page.getByText(text(copy.loop.progress, { answered: "0", writers: "3" }))).toBeVisible();

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByLabel(copy.questionPacks[0].questions[0]).fill("A cat fist bump.");
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedInRound);

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText(text(copy.loop.progress, { answered: "1", writers: "3" }))).toBeVisible();
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
  await page.getByLabel(copy.questionPacks[0].questions[0]).fill("Not mine to write.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^Go to / })).toHaveCount(0);

  // Their own link does, and it lands on the loop.
  await page.goto(`/r/${loop.ownerToken}`);
  await waitForSheet(page);
  await page.getByLabel(copy.questionPacks[0].questions[0]).fill("My own words.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Go to / }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));
});

test("D5 · Done with nothing written points at the first question", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  const done = page.getByRole("button", { name: copy.reply.done, exact: true });
  await expect(done).not.toHaveAttribute("aria-disabled", "true");
  await done.click();
  await expect(page.getByRole("alert").filter({ hasText: copy.reply.nothingWritten })).toBeVisible();
  await expect(page.getByLabel(copy.questionPacks[0].questions[0])).toBeFocused();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title })).toHaveCount(0);
});

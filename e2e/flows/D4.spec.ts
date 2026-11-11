import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, waitForSheet } from "../support/harness";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

async function openSheet(page: import("@playwright/test").Page) {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  // Put the browser and the server on the instant the fixtures were built at.
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  return { loop, alice };
}

test("D4 · the sheet names the deadline in the loop's own clock, and says what goes out then", async ({ page }) => {
  await openSheet(page);

  // The seeded round goes out on the Friday after it opened, at the same local
  // wall clock (9:05 Amsterdam here). The person answering is always told that,
  // and their own time first when their device is somewhere else.
  await expect(page.getByText(copyPattern(copy.reply.closes, { values: { deadline: /on (.+ your time \()?Fri 9 Jan, 9:05 AM( in Amsterdam\))?/ }, start: true, end: true }))).toBeVisible();
  // There is no send step, so half a thought goes out too: the sheet says so beside the deadline.
  await expect(page.getByText(copy.reply.goesOutNote)).toBeVisible();
});

test("D4 · typing saves the answer into the round, and it survives a reload", async ({ page }) => {
  const { loop, alice } = await openSheet(page);

  const answer = page.getByLabel(copy.questionPacks[0].questions[0]);
  await answer.fill("The dog, the baguette, the whole thing.");
  await expect(page.getByText(copy.reply.questionStates.saved, { exact: true })).toBeVisible();
  await expect(page.locator("[data-save-status]")).toHaveText(copy.reply.savedInRound);
  // Nothing else to press: what is saved is an answer.
  await expect(page.getByRole("button", { name: /^Send (new )?answers$/ })).toHaveCount(0);
  await expect.poll(async () => (await rows<{ body: string }>(
    "select body from replies where membership_id = $1 and body <> ''",
    [alice.id],
  )).map((row) => row.body)).toEqual(["The dog, the baguette, the whole thing."]);

  await page.reload();
  await expect(page.getByLabel(copy.questionPacks[0].questions[0])).toHaveValue(
    "The dog, the baguette, the whole thing.",
  );
  await expect(page.getByText(copyPattern(copy.reply.answered, { values: { answered: "1", total: "2" }, flags: "i" })).first()).toBeVisible();
  expect(loop.groupId).toBeTruthy();
});

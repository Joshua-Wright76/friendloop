import { test, expect, type Page } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const queueList = (page: Page) => page.getByRole("list", { name: "Questions that take turns, in the order rounds ask them" });

function queue(groupId: string) {
  return rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [groupId])
    .then((result) => result.map((row) => row.text));
}

test("C2 · moving a turn-taker changes the order coming rounds ask them, not this round's", async ({ page }) => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3", "Q4"] });
  await rows("update groups set questions_per_round = 1 where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT); // round 1 asks Q1
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);

  const rowsOf = queueList(page).locator(":scope > li");
  await expect(rowsOf.first()).toContainText("Q2");
  await expect(rowsOf.first()).toContainText("Round 2 · Fri 16 Jan");

  // A tap on the grip opens Up and Down on that row.
  await page.getByRole("button", { name: "Move: Q2" }).click();
  await page.getByRole("button", { name: "Move down: Q2" }).click();
  await expect(rowsOf.first()).toContainText("Q3");
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q3", "Q2", "Q4", "Q1"]);
  // Focus stays on the control that moved, and the rounds shown follow the new order.
  await expect(page.getByRole("button", { name: "Move down: Q2" })).toBeFocused();
  await expect(rowsOf.nth(1)).toContainText("Round 3 · Fri 23 Jan");

  // The keyboard picks a row up with Space, carries it, and sets it down. Each step is announced.
  const spoken = page.locator('[id^="DndLiveRegion"]').first();
  const grip = page.getByRole("button", { name: "Move: Q4" });
  await grip.focus();
  await page.keyboard.press("Space");
  await expect(spoken).toHaveText("Picked up Q4, at 3 of 4.");
  await page.keyboard.press("ArrowUp");
  await expect(spoken).toHaveText("Q4 is at 2 of 4.");
  await page.keyboard.press("ArrowUp");
  await expect(spoken).toHaveText("Q4 is at 1 of 4.");
  await page.keyboard.press("Space");
  await expect.poll(() => queue(loop.groupId)).toEqual(["Q4", "Q3", "Q2", "Q1"]);
  await expect(rowsOf.first()).toContainText("Q4");

  // This round keeps its own order.
  const asked = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(asked.map((row) => row.text)).toEqual(["Q1"]);
});

test("C2 · every-round items reorder among themselves", async ({ page }) => {
  const loop = await seedLoop({ questions: [] });
  for (const [index, title] of ["Wall", "Music", "Notes"].entries()) {
    await rows("insert into questions (group_id, text, frequency, format, active, position) values ($1, $2, 'every_round', 'written', true, $3)", [loop.groupId, title, index]);
  }
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await page.getByRole("button", { name: "Move: Notes" }).click();
  await page.getByRole("button", { name: "Move up: Notes" }).click();
  await expect.poll(async () => (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text))
    .toEqual(["Wall", "Notes", "Music"]);
});

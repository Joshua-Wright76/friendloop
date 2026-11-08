import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addCard, fillItem, openItem, runSweep, signIn } from "../support/harness";
import { AFTER_FIRST_SLOT } from "../support/clock";

test.beforeEach(async () => {
  await resetDatabase();
});

test("L1 · the owner adds a poll that lives in the queue like any question", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  const card = addCard(page);

  // Two options that read the same are one option: the page says so plainly.
  await fillItem(page, card, { text: "Where should we camp?", format: "Poll", options: ["The lake", "the lake"] });
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("A poll needs two to six different options, each under 80 characters.")).toBeVisible();
  expect(await rows("select 1 from questions where format = 'poll'")).toHaveLength(0);

  // A real one, allowing more than one pick. Two option fields to start; more appear one at a time, and the new one takes focus.
  await fillItem(page, card, { text: "Where should we camp?", format: "Poll", options: ["The lake", "The mountains"] });
  await expect(card.getByLabel("Option 3")).toHaveCount(0);
  await card.getByRole("button", { name: "Add option" }).click();
  await expect(card.getByLabel("Option 3")).toBeFocused();
  await card.getByLabel("Option 3").fill("The coast");
  await card.getByLabel("People can pick more than one").check();
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Added. It's in Up next.")).toBeVisible();

  const [poll] = await rows<{ text: string; poll_options: string[]; poll_multiple: boolean; kind: string }>(
    "select text, poll_options, poll_multiple, kind from questions where format = 'poll'",
  );
  expect({ ...poll }).toEqual({ text: "Where should we camp?", poll_options: ["The lake", "The mountains", "The coast"], poll_multiple: true, kind: "poll" });

  // It sits at the end of the queue, labelled, with its options listed.
  const queue = page.getByRole("list", { name: "Questions that take turns, in the order rounds ask them" });
  const item = queue.locator(":scope > li").last();
  await expect(item).toContainText("Where should we camp?");
  await expect(item).toContainText("Poll");
  await expect(item).toContainText("The lake, The mountains, The coast");

  // It moves like a question.
  await page.getByRole("button", { name: "Move: Where should we camp?" }).click();
  await page.getByRole("button", { name: "Move up: Where should we camp?" }).click();
  await expect.poll(async () =>
    (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text),
  ).toEqual(["What made you laugh this week?", "Where should we camp?", "What are you looking forward to?"]);

  // The next round carries it, options frozen into the issue.
  await runSweep(AFTER_FIRST_SLOT);
  const snapshot = await rows<{ kind: string; poll_options: string[] }>("select kind, poll_options from issue_questions where format = 'poll'");
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0].poll_options).toEqual(["The lake", "The mountains", "The coast"]);

  // And it stops like one.
  await page.reload();
  const row = await openItem(page, "Where should we camp?", 1);
  await row.getByRole("button", { name: "Stop asking: Where should we camp?" }).click();
  await row.getByRole("button", { name: "Yes, stop asking" }).click();
  await expect(page.getByText(/^Stopped asking/)).toBeVisible();
  const [stopped] = await rows<{ archived_at: string | null }>("select archived_at from questions where format = 'poll'");
  expect(stopped.archived_at).not.toBeNull();
});

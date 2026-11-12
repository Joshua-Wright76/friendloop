import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPlan } from "../support/questions";
import { addCard, fillItem, openItem, runSweep, signIn } from "../support/harness";
import { AFTER_FIRST_SLOT } from "../support/clock";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("L1 · the owner adds a poll that lives in the queue like any question", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPlan(page);
  const card = addCard(page);

  // Two options that read the same are one option: the page says so plainly.
  await fillItem(page, card, { text: "Where should we camp?", format: copy.questions.item.formats.poll, options: ["The lake", "the lake"] });
  await card.getByRole("button", { name: copy.questions.add.submit, exact: true }).click();
  await expect(page.getByText(copy.questions.errors.poll)).toBeVisible();
  expect(await rows("select 1 from questions where format = 'poll'")).toHaveLength(0);

  // A real one, allowing more than one pick. Two option fields to start; more appear one at a time, and the new one takes focus.
  await fillItem(page, card, { text: "Where should we camp?", format: copy.questions.item.formats.poll, options: ["The lake", "The mountains"] });
  await expect(card.getByLabel(copyText(copy.polls.authoring.optionLabel, { number: "3" }))).toHaveCount(0);
  await card.getByRole("button", { name: copy.polls.authoring.addOption }).click();
  await expect(card.getByLabel(copyText(copy.polls.authoring.optionLabel, { number: "3" }))).toBeFocused();
  await card.getByLabel(copyText(copy.polls.authoring.optionLabel, { number: "3" })).fill("The coast");
  await card.getByLabel(copy.polls.authoring.multipleLabel).check();
  await card.getByRole("button", { name: copy.questions.add.submit, exact: true }).click();
  await expect(page.getByText(copy.questions.done.added)).toBeVisible();

  const [poll] = await rows<{ text: string; poll_options: string[]; poll_multiple: boolean; kind: string }>(
    "select text, poll_options, poll_multiple, kind from questions where format = 'poll'",
  );
  expect({ ...poll }).toEqual({ text: "Where should we camp?", poll_options: ["The lake", "The mountains", "The coast"], poll_multiple: true, kind: "poll" });

  // It sits at the end of the queue, labelled, with its options listed.
  await openPlan(page);
  const queue = page.getByRole("list", { name: copy.questions.upNext.turnsLabel });
  const item = queue.locator(":scope > li").last();
  await expect(item).toContainText("Where should we camp?");
  await expect(item).toContainText(copy.questions.item.formats.poll);
  await expect(item).toContainText("The lake, The mountains, The coast");

  // It moves like a question.
  await page.getByRole("button", { name: copyText(copy.reorder.gripLabel, { item: "Where should we camp?" }) }).click();
  await page.getByRole("button", { name: copyText(copy.reorder.upLabel, { item: "Where should we camp?" }) }).click();
  await expect.poll(async () =>
    (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text),
  ).toEqual([copy.questionPacks[0].questions[0], "Where should we camp?", "What are you looking forward to?"]);

  // The next round carries it, options frozen into the issue.
  await runSweep(AFTER_FIRST_SLOT);
  const snapshot = await rows<{ kind: string; poll_options: string[] }>("select kind, poll_options from issue_questions where format = 'poll'");
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0].poll_options).toEqual(["The lake", "The mountains", "The coast"]);

  // And it stops like one.
  await page.reload();
  await openPlan(page);
  const row = await openItem(page, "Where should we camp?", 1);
  await row.getByRole("button", { name: copyText(copy.questions.item.stopLabel, { item: "Where should we camp?" }) }).click();
  await row.getByRole("button", { name: copy.questions.item.stopConfirm }).click();
  await expect(page.getByText(new RegExp(`^(${copyPattern(copy.questions.done.stopped).source}|${copyPattern(copy.questions.done.stoppedStays).source})`))).toBeVisible();
  const [stopped] = await rows<{ archived_at: string | null }>("select archived_at from questions where format = 'poll'");
  expect(stopped.archived_at).not.toBeNull();
});

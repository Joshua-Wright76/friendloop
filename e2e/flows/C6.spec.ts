import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPart, signIn } from "../support/harness";
import { QUESTION_PACKS } from "@/lib/question-packs";

const pack = (name: string) => {
  const found = QUESTION_PACKS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No pack named ${name}`);
  return found;
};

const poolTexts = (groupId: string) =>
  rows<{ text: string }>(
    "select text from questions where group_id = $1 and archived_at is null order by position",
    [groupId],
  ).then((result) => result.map((row) => row.text));

test.beforeEach(async () => {
  await resetDatabase();
});

test("C6 · questions can be picked across packs and added to the pool", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Add more");

  // Every pack starts as one row, with its counts.
  const silly = page.getByRole("group", { name: "Silly hypotheticals", exact: true });
  await expect(silly.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: /^Silly hypotheticals/ }).click();
  await silly.getByRole("checkbox").nth(0).check();
  await silly.getByRole("checkbox").nth(1).check();

  await page.getByRole("button", { name: /^Tiny joys/ }).click();
  const tiny = page.getByRole("group", { name: "Tiny joys", exact: true });
  await tiny.getByRole("checkbox").nth(2).check();
  // Picks in a folded pack still count.
  await page.getByRole("button", { name: /^Silly hypotheticals/ }).click();
  await expect(silly.getByRole("checkbox")).toHaveCount(0);

  await expect(page.getByText("3 selected")).toBeVisible();
  await page.getByRole("button", { name: "Add to your questions" }).click();
  await expect(page.getByText("3 questions added.")).toBeVisible();

  const sillyQuestions = pack("Silly hypotheticals").questions;
  const tinyQuestions = pack("Tiny joys").questions;
  expect(await poolTexts(loop.groupId)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    sillyQuestions[0],
    sillyQuestions[1],
    tinyQuestions[2],
  ]);
});

test("C6 · a whole pack adds at once and questions already in the pool are skipped", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Add more");

  await page.getByRole("button", { name: "Add all questions in Travel" }).click();
  await expect(page.getByText(`${pack("Travel").questions.length} selected`)).toBeVisible();
  await page.getByRole("button", { name: "Add to your questions" }).click();
  await expect(page.getByText(`${pack("Travel").questions.length} questions added.`)).toBeVisible();
  expect(await poolTexts(loop.groupId)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    ...pack("Travel").questions,
  ]);

  // The pack's questions are now in the pool: ticked, fixed, and labelled, with nothing left to add.
  await page.getByRole("button", { name: /^Travel/ }).click();
  const travel = page.getByRole("group", { name: "Travel", exact: true });
  await expect(travel.getByRole("checkbox").first()).toBeChecked();
  await expect(travel.getByRole("checkbox").first()).toBeDisabled();
  await expect(travel.getByText("Already added", { exact: true })).toHaveCount(pack("Travel").questions.length);
  await expect(page.getByRole("button", { name: "Add all questions in Travel" })).toHaveCount(0);

  // "Add all" on a pack that is partly in the pool picks only the new ones.
  const everyday = pack("Everyday").questions;
  await page.getByRole("button", { name: "Add all questions in Everyday" }).click();
  await expect(page.getByText(`${everyday.length - 2} selected`)).toBeVisible();
  await page.getByRole("button", { name: "Remove all questions in Everyday" }).click();
  await expect(page.getByText("0 selected")).toBeVisible();
  const fresh = everyday[2];
  await page.getByRole("button", { name: /^Everyday/ }).click();
  await page.getByRole("group", { name: "Everyday", exact: true }).getByText(fresh).click();
  await page.getByRole("button", { name: "Add to your questions" }).click();
  await expect(page.getByText("1 question added.")).toBeVisible();

  const after = await poolTexts(loop.groupId);
  expect(after).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    ...pack("Travel").questions,
    fresh,
  ]);
});

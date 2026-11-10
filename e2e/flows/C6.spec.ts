import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { addCard, signIn, unfoldIn } from "../support/harness";
import { QUESTION_PACKS } from "@/lib/question-packs";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

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
  await unfoldIn(addCard(page), copy.questions.add.packsSummary);

  // Every pack starts as one row, with its counts.
  const silly = page.getByRole("group", { name: copy.questionPacks[11].name, exact: true });
  await expect(silly.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: copyPattern(copy.questionPacks[11].name, { start: true }) }).click();
  await silly.getByRole("checkbox").nth(0).check();
  await silly.getByRole("checkbox").nth(1).check();

  await page.getByRole("button", { name: copyPattern(copy.questionPacks[8].name, { start: true }) }).click();
  const tiny = page.getByRole("group", { name: copy.questionPacks[8].name, exact: true });
  await tiny.getByRole("checkbox").nth(2).check();
  // Picks in a folded pack still count.
  await page.getByRole("button", { name: copyPattern(copy.questionPacks[11].name, { start: true }) }).click();
  await expect(silly.getByRole("checkbox")).toHaveCount(0);

  await expect(page.getByText(copyText(copy.common.selectedCount, { count: "3" }))).toBeVisible();
  await page.getByRole("button", { name: copy.questions.addToPool }).click();
  await expect(page.getByText(copyText(copy.questions.fromPacksAdded, { count: "3" }))).toBeVisible();

  const sillyQuestions = pack("Silly hypotheticals").questions;
  const tinyQuestions = pack("Tiny joys").questions;
  expect(await poolTexts(loop.groupId)).toEqual([
    copy.questionPacks[0].questions[0],
    copy.questionPacks[0].questions[1],
    sillyQuestions[0],
    sillyQuestions[1],
    tinyQuestions[2],
  ]);
});

test("C6 · a whole pack adds at once and questions already in the pool are skipped", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await unfoldIn(addCard(page), copy.questions.add.packsSummary);

  await page.getByRole("button", { name: copyText(copy.questions.packAddAllLabel, { pack: copy.questionPacks[1].name }) }).click();
  await expect(page.getByText(`${pack(copy.questionPacks[1].name).questions.length} selected`)).toBeVisible();
  await page.getByRole("button", { name: copy.questions.addToPool }).click();
  await expect(page.getByText(`${pack(copy.questionPacks[1].name).questions.length} questions added.`)).toBeVisible();
  expect(await poolTexts(loop.groupId)).toEqual([
    copy.questionPacks[0].questions[0],
    copy.questionPacks[0].questions[1],
    ...pack("Travel").questions,
  ]);

  // The pack's questions are now in the pool: ticked, fixed, and labelled, with nothing left to add.
  await page.getByRole("button", { name: copyPattern(copy.questionPacks[1].name, { start: true }) }).click();
  const travel = page.getByRole("group", { name: copy.questionPacks[1].name, exact: true });
  await expect(travel.getByRole("checkbox").first()).toBeChecked();
  await expect(travel.getByRole("checkbox").first()).toBeDisabled();
  await expect(travel.getByText(copy.questions.inPoolTag, { exact: true })).toHaveCount(pack("Travel").questions.length);
  await expect(page.getByRole("button", { name: copyText(copy.questions.packAddAllLabel, { pack: copy.questionPacks[1].name }) })).toHaveCount(0);

  // "Add all" on a pack that is partly in the pool picks only the new ones.
  const everyday = pack("Everyday").questions;
  await page.getByRole("button", { name: copyText(copy.questions.packAddAllLabel, { pack: copy.questionPacks[0].name }) }).click();
  await expect(page.getByText(`${everyday.length - 2} selected`)).toBeVisible();
  await page.getByRole("button", { name: copyText(copy.questions.packRemoveAllLabel, { pack: copy.questionPacks[0].name }) }).click();
  await expect(page.getByText(copyText(copy.common.selectedCount, { count: "0" }))).toBeVisible();
  const fresh = everyday[2];
  await page.getByRole("button", { name: copyPattern(copy.questionPacks[0].name, { start: true }) }).click();
  await page.getByRole("group", { name: copy.questionPacks[0].name, exact: true }).getByText(fresh).click();
  await page.getByRole("button", { name: copy.questions.addToPool }).click();
  await expect(page.getByText(copy.questions.fromPacksAddedOne)).toBeVisible();

  const after = await poolTexts(loop.groupId);
  expect(after).toEqual([
    copy.questionPacks[0].questions[0],
    copy.questionPacks[0].questions[1],
    ...pack("Travel").questions,
    fresh,
  ]);
});

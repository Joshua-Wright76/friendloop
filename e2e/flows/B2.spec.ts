import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";
import { QUESTION_PACKS } from "@/lib/question-packs";
import { STARTER_PACK_IDS, STARTER_PER_ROUND, starterQuestions } from "@/lib/starter-questions";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

const NEXT = "Continue to the next setup step";

async function moveToDetails(page: import("@playwright/test").Page, title: string) {
  await page.goto("/g/new");
  await page.getByLabel(copy.newLoop.nameLabel).fill(title);
  await page.getByRole("button", { name: NEXT }).click();
  // The optional paper-and-picture step: leave it alone.
  await page.getByRole("button", { name: NEXT }).click();
}

async function continueFromReaders(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: NEXT }).click();
}

/** Open every starter pack and untick what the wizard picked, to choose from scratch. */
async function clearStarter(page: import("@playwright/test").Page) {
  for (const id of STARTER_PACK_IDS) {
    const pack = QUESTION_PACKS.find((candidate) => candidate.id === id)!;
    const group = page.getByRole("group", { name: pack.name, exact: true });
    const toggle = group.getByRole("button", { name: copyPattern(pack.name, { start: true }) });
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    const ticked = group.getByRole("checkbox", { checked: true });
    while ((await ticked.count()) > 0) await ticked.first().uncheck();
  }
  await expect(page.getByText(copyText(copy.newLoop.wizard.questions.selected, { count: 0 }))).toBeVisible();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("B2 · the starter set and a quick idea become the ordered pool, asked a few at a time", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Book Club");

  // A new loop starts with fifteen picked across packs (in library order under test), and says they take turns.
  const starter = starterQuestions(QUESTION_PACKS, null);
  await expect(page.getByText(copyText(copy.newLoop.wizard.questions.selected, { count: starter.length }))).toBeVisible();
  await expect(page.getByText(copyText(copy.newLoop.wizard.questions.rotation, { perRound: STARTER_PER_ROUND }))).toBeVisible();
  // Every pack starts folded; open, the picks are ticked.
  await page.getByRole("button", { name: new RegExp(`^${QUESTION_PACKS[0].name}`) }).click();
  const questions = page.getByRole("checkbox");
  await expect(questions.nth(0)).toBeChecked();
  await expect(questions.nth(1)).toBeChecked();
  // The ideas sit on the same step and are stored as the plain question.
  const idea = page.getByRole("button", { name: /What was one good moment recently\?/ });
  await idea.click();
  await expect(idea).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: NEXT }).click();
  await continueFromReaders(page);

  await page.getByRole("button", { name: copy.newLoop.wizard.note.previewButton }).click();
  const preview = page.getByRole("dialog", { name: copy.newLoop.wizard.note.previewTitle });
  await expect(preview.getByText("Book Club")).toBeVisible();
  // It shows what the first round really asks: the top of the list, not everything picked.
  await expect(preview.getByRole("listitem")).toHaveCount(STARTER_PER_ROUND);
  await expect(preview.getByText(starter[0])).toBeVisible();
  await expect(preview.getByText(copy.newLoop.wizard.questions.ideas[0].question)).toHaveCount(0);
  await preview.getByRole("button", { name: copy.newLoop.wizard.note.closePreview }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const pool = await rows<{ text: string; position: number }>(
    `select q.text, q.position from questions q
     join groups g on g.id = q.group_id where g.name = $1 order by q.position`,
    ["Book Club"],
  );
  // Rotation is on from the start: round 1 asked the top of the pool, which then went to the back of the line.
  const ideaText = copy.newLoop.wizard.questions.ideas[0].question;
  expect(pool.map((row) => row.text)).toEqual([...starter.slice(STARTER_PER_ROUND), ideaText, ...starter.slice(0, STARTER_PER_ROUND)]);
  const [group] = await rows<{ questions_per_round: number | null }>("select questions_per_round from groups where name = $1", ["Book Club"]);
  expect(group.questions_per_round).toBe(STARTER_PER_ROUND);
  const asked = await rows<{ text: string }>(
    `select iq.text from issue_questions iq join issues i on i.id = iq.issue_id
     join groups g on g.id = i.group_id where g.name = $1 and i.number = 1 order by iq.position`,
    ["Book Club"],
  );
  expect(asked.map((row) => row.text)).toEqual(starter.slice(0, STARTER_PER_ROUND));
});

test("B2 · the question bank can start with more than eight prompts", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Long Table");

  // Every pack starts folded and opens on demand.
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: new RegExp(`^${QUESTION_PACKS[0].name}`) }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(QUESTION_PACKS[0].questions.length);

  // Clear the starter set, to choose from scratch.
  await clearStarter(page);
  await expect(page.getByText(copy.newLoop.wizard.questions.empty)).toBeVisible();

  // Questions can be picked across packs, several open at once.
  const tiny = page.getByRole("group", { name: copy.questionPacks[8].name, exact: true });
  await expect(tiny.getByRole("checkbox")).toHaveCount(
    QUESTION_PACKS.find((pack) => pack.name === "Tiny joys")!.questions.length,
  );
  for (let index = 0; index < 4; index += 1) await tiny.getByRole("checkbox").nth(index).check();

  const food = page.getByRole("group", { name: copy.questionPacks[2].name, exact: true });
  for (let index = 0; index < 5; index += 1) await food.getByRole("checkbox").nth(index).check();

  await expect(page.getByText(copyText(copy.common.selectedCount, { count: "9" }))).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const count = await rows<{ count: number }>(
    `select count(*)::int as count from questions q
     join groups g on g.id = q.group_id where g.name = $1`,
    ["Long Table"],
  );
  expect(count).toEqual([{ count: 9 }]);
});

test("B2 · a short list is asked whole every round", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Small Table");

  await clearStarter(page);
  const everyday = page.getByRole("group", { name: QUESTION_PACKS[0].name, exact: true });
  for (let index = 0; index < STARTER_PER_ROUND; index += 1) await everyday.getByRole("checkbox").nth(index).check();
  await expect(page.getByText(copyText(copy.newLoop.wizard.questions.rotationAll, { perRound: STARTER_PER_ROUND }))).toBeVisible();

  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const [group] = await rows<{ questions_per_round: number | null }>("select questions_per_round from groups where name = $1", ["Small Table"]);
  // The loop still takes turns: five a round, which for now is all it has.
  expect(group.questions_per_round).toBe(STARTER_PER_ROUND);
});

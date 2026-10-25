import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";

const NEXT = "Continue to the next setup step";

async function moveToDetails(page: import("@playwright/test").Page, title: string) {
  await page.goto("/g/new");
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByLabel("Loop title").fill(title);
  await page.getByRole("button", { name: NEXT }).click();
}

async function continueFromReaders(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: NEXT }).click();
}

test.beforeEach(async () => {
  await resetDatabase();
});

test("B2 · defaults and section prompts become the ordered question pool", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Book Club");

  const questions = page.getByRole("checkbox");
  await expect(questions.nth(0)).toBeChecked();
  await expect(questions.nth(1)).toBeChecked();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: /Bright spots/ }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await continueFromReaders(page);

  await page.getByRole("button", { name: "Preview the first issue" }).click();
  const preview = page.getByRole("dialog", { name: "A first look" });
  await expect(preview.getByText("Book Club")).toBeVisible();
  await expect(preview.getByText("Bright spots: What was one good moment from your week?")).toBeVisible();
  await preview.getByRole("button", { name: "Close issue preview" }).click();
  await page.getByRole("button", { name: "Create this loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const pool = await rows<{ text: string; position: number }>(
    `select q.text, q.position from questions q
     join groups g on g.id = q.group_id where g.name = $1 order by q.position`,
    ["Book Club"],
  );
  expect(pool.map((row) => row.text)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    "Bright spots: What was one good moment from your week?",
  ]);
  expect(pool.map((row) => row.position)).toEqual([0, 1, 2]);
});

test("B2 · From You keeps invitations reader-only and sends the personal note", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.goto("/g/new");
  await page.getByRole("button", { name: /From You/ }).click();
  await page.getByRole("button", { name: NEXT }).click();

  await page.getByRole("button", { name: "See name ideas" }).click();
  const ideas = page.getByRole("dialog", { name: "Name ideas" });
  await ideas.getByRole("button", { name: "The Good Things Letter" }).click();
  await page.getByRole("button", { name: "Monthly (4 weeks)" }).click();
  await page.getByRole("button", { name: NEXT }).click();

  await page.getByRole("button", { name: "Add your own question" }).click();
  const questionDialog = page.getByRole("dialog", { name: "Add a question" });
  await questionDialog.getByRole("textbox", { name: "Question" }).fill("What would you like to ask?");
  await questionDialog.getByRole("button", { name: "Add question" }).click();
  await page.getByRole("button", { name: NEXT }).click();

  await page.getByRole("button", { name: "Write a custom prompt" }).click();
  const sectionDialog = page.getByRole("dialog", { name: "Write a prompt" });
  await sectionDialog.getByLabel("Prompt title").fill("Three good things");
  await sectionDialog.getByLabel("Question or prompt").fill("What are three good things from your week?");
  await sectionDialog.getByRole("button", { name: "Add prompt" }).click();
  await page.getByRole("button", { name: NEXT }).click();

  const emailInput = page.getByLabel("Email addresses");
  await emailInput.fill("reader@example.test");
  await emailInput.press("Enter");
  await expect(page.getByText("reader@example.test", { exact: true })).toBeVisible();
  await emailInput.fill("reader@example.test");
  await emailInput.press("Enter");
  await expect(page.getByRole("status")).toHaveText("That email is already on the list.");

  await emailInput.fill("not-an-email");
  await emailInput.press("Enter");
  await expect(page.getByText("Enter a valid email address before continuing.", { exact: true })).toBeVisible();
  await emailInput.fill("remove@example.test");
  await emailInput.press("Enter");
  await page.getByRole("button", { name: "Remove remove@example.test" }).click();
  await expect(page.getByText("remove@example.test", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: NEXT }).click();
  await page.getByLabel("Your invitation note").fill("I miss you all and wanted to make a small place for our updates.");
  await page.getByRole("button", { name: "Preview the first issue" }).click();
  const preview = page.getByRole("dialog", { name: "A first look" });
  await expect(preview.getByText("The Good Things Letter")).toBeVisible();
  await expect(preview.getByText("What would you like to ask?")).toBeVisible();
  await expect(preview.getByText("I miss you all and wanted to make a small place for our updates.")).toBeVisible();
  await preview.getByRole("button", { name: "Close issue preview" }).click();
  await page.getByRole("button", { name: "Create this loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const group = await rows<{ mode: string; cadence_weeks: number }>(
    "select mode, cadence_weeks from groups where name = $1",
    ["The Good Things Letter"],
  );
  expect(group).toEqual([{ mode: "from_you", cadence_weeks: 4 }]);

  const invitee = await rows<{ email: string; participation: string }>(
    `select m.email, m.participation from memberships m
     join groups g on g.id = m.group_id where g.name = $1 and m.email = $2`,
    ["The Good Things Letter", "reader@example.test"],
  );
  expect(invitee).toEqual([{ email: "reader@example.test", participation: "reader" }]);

  const pool = await rows<{ text: string }>(
    `select q.text from questions q join groups g on g.id = q.group_id
     where g.name = $1 order by q.position`,
    ["The Good Things Letter"],
  );
  expect(pool.map((row) => row.text)).toEqual([
    "What made you laugh this week?",
    "What are you looking forward to?",
    "What would you like to ask?",
    "Three good things: What are three good things from your week?",
  ]);

  const invitations = await rows<{ html: string; text: string }>(
    `select html, text from outbox where kind = 'invite' and "to" = $1`,
    ["reader@example.test"],
  );
  expect(invitations).toHaveLength(1);
  expect(invitations[0].html).toContain("I miss you all and wanted to make a small place for our updates.");
  expect(invitations[0].text).toContain("I miss you all and wanted to make a small place for our updates.");
});

test("B2 · the question bank can start with more than eight prompts", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await moveToDetails(page, "Long Table");

  const questions = page.getByRole("checkbox");
  await expect(questions).toHaveCount(13);
  for (let index = 0; index < 9; index += 1) await questions.nth(index).check();
  await expect(page.getByText("9 selected")).toBeVisible();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: NEXT }).click();
  await page.getByRole("button", { name: "Create this loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+/);

  const count = await rows<{ count: number }>(
    `select count(*)::int as count from questions q
     join groups g on g.id = q.group_id where g.name = $1`,
    ["Long Table"],
  );
  expect(count).toEqual([{ count: 9 }]);
});

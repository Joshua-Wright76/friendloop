import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { runSweep, signIn } from "../support/harness";
import { AFTER_FIRST_SLOT } from "../support/clock";

test.beforeEach(async () => {
  await resetDatabase();
});

test("L1 · the owner adds a poll that lives in the pool like any question", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);

  // Two options that read the same are one option: the form says so plainly.
  await page.getByLabel("Poll question").fill("Where should we camp?");
  await page.getByLabel("Option 1").fill("The lake");
  await page.getByLabel("Option 2").fill("the lake");
  await page.getByRole("button", { name: "Add poll" }).click();
  await expect(page.getByText("A poll needs a question and two to six different options.")).toBeVisible();
  expect(await rows("select 1 from questions where kind = 'poll'")).toHaveLength(0);

  // A real one, allowing more than one pick.
  await page.getByLabel("Poll question").fill("Where should we camp?");
  await page.getByLabel("Option 1").fill("The lake");
  await page.getByLabel("Option 2").fill("The mountains");
  await page.getByLabel("Option 3").fill("The coast");
  await page.getByLabel("People can pick more than one").check();
  await page.getByRole("button", { name: "Add poll" }).click();
  await expect(page.getByText("Poll added.")).toBeVisible();

  const [poll] = await rows<{ text: string; poll_options: string[]; poll_multiple: boolean }>(
    "select text, poll_options, poll_multiple from questions where kind = 'poll'",
  );
  expect(poll.text).toBe("Where should we camp?");
  expect(poll.poll_options).toEqual(["The lake", "The mountains", "The coast"]);
  expect(poll.poll_multiple).toBe(true);

  // It sits at the end of the pool, labelled, with its options listed.
  const pool = page.getByRole("list", { name: "Questions in round order" });
  const item = pool.locator(":scope > li").last();
  await expect(item).toContainText("Where should we camp?");
  await expect(item).toContainText("Poll · pick any");
  await expect(item).toContainText("The mountains");

  // It reorders and archives like a question.
  await item.getByRole("button", { name: "Up", exact: true }).click();
  await expect(pool.locator(":scope > li").nth(1)).toContainText("Where should we camp?");
  await expect.poll(async () =>
    (await rows<{ text: string }>("select text from questions where group_id = $1 order by position", [loop.groupId])).map((row) => row.text),
  ).toEqual(["What made you laugh this week?", "Where should we camp?", "What are you looking forward to?"]);

  // The next round carries it, options frozen into the issue.
  await runSweep(AFTER_FIRST_SLOT);
  const snapshot = await rows<{ kind: string; poll_options: string[] }>(
    "select kind, poll_options from issue_questions where kind = 'poll'",
  );
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0].poll_options).toEqual(["The lake", "The mountains", "The coast"]);

  await pool.locator(":scope > li").nth(1).getByRole("button", { name: /^Archive/ }).click();
  await pool.locator(":scope > li").nth(1).getByRole("button", { name: /^Yes, archive/ }).click(); // archiving asks first
  await expect(page.getByText("Archived.")).toBeVisible();
  await expect(page.getByText("Where should we camp?")).toHaveCount(0);
  const [archived] = await rows<{ archived_at: string | null }>("select archived_at from questions where kind = 'poll'");
  expect(archived.archived_at).not.toBeNull();
});

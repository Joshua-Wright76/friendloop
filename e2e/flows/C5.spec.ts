import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, DAY, pickOption, runSweep, sendNow, signIn, unfold } from "../support/harness";

const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"];

test.beforeEach(async () => {
  await resetDatabase();
});

function questionsForRound(groupId: string, number: number) {
  return rows<{ text: string }>(
    `select iq.text from issue_questions iq
     join issues i on i.id = iq.issue_id
     where i.group_id = $1 and i.number = $2 order by iq.position`,
    [groupId, number],
  ).then((result) => result.map((row) => row.text));
}

test("C5 · a question count rotates scheduled rounds and wraps", async ({ page }) => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await unfold(page, /Each round asks/);
  // Choosing a count saves it.
  await pickOption(page, "Questions per round", "2");
  await expect(page.getByText("Questions per round updated.")).toBeVisible();

  await runSweep(AFTER_FIRST_SLOT);
  expect(await questionsForRound(loop.groupId, 1)).toEqual(["Q1", "Q2"]);
  const [first] = await rows<{ id: string }>("select id from issues where group_id = $1 and number = 1", [loop.groupId]);
  await seedReplies({ issueId: first.id, membershipId: loop.members[0].id, answers: [{ text: "Q1", body: "Answer" }] });

  await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + 7 * DAY));
  expect(await questionsForRound(loop.groupId, 2)).toEqual(["Q3", "Q4"]);
  const [second] = await rows<{ id: string }>("select id from issues where group_id = $1 and number = 2", [loop.groupId]);
  await seedReplies({ issueId: second.id, membershipId: loop.members[0].id, answers: [{ text: "Q3", body: "Answer" }] });

  await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + 14 * DAY));
  expect(await questionsForRound(loop.groupId, 3)).toEqual(["Q5", "Q1"]);

  const [group] = await rows<{ question_cursor: number; questions_per_round: number }>(
    "select question_cursor, questions_per_round from groups where id = $1",
    [loop.groupId],
  );
  expect(group).toEqual({ question_cursor: 1, questions_per_round: 2 });
});

test("C5 · saving an unchanged count keeps the cursor", async ({ page }) => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await rows("update groups set questions_per_round = 2, question_cursor = 4 where id = $1", [loop.groupId]);
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  // Choosing the count it already has still saves, and must leave the cursor alone.
  await unfold(page, /Each round asks/);
  await pickOption(page, "Questions per round", "2");
  await expect(page.getByText("Questions per round updated.")).toBeVisible();

  const [group] = await rows<{ question_cursor: number }>(
    "select question_cursor from groups where id = $1",
    [loop.groupId],
  );
  expect(group.question_cursor).toBe(4);
});

test("C5 · send now uses the same rotation", async ({ page }) => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT);
  expect(await questionsForRound(loop.groupId, 1)).toEqual(["Q1", "Q2"]);
  const [first] = await rows<{ id: string }>("select id from issues where group_id = $1 and number = 1", [loop.groupId]);
  await seedReplies({ issueId: first.id, membershipId: loop.members[1].id, answers: [{ text: "Q1", body: "Answer" }] });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}`);
  await sendNow(page);
  await expect(page.getByText(/Round 2 is open for answers/)).toBeVisible();

  expect(await questionsForRound(loop.groupId, 2)).toEqual(["Q3", "Q4"]);
  const [group] = await rows<{ question_cursor: number }>(
    "select question_cursor from groups where id = $1",
    [loop.groupId],
  );
  expect(group.question_cursor).toBe(4);
});

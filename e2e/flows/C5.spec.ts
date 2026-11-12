import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { openPlan } from "../support/questions";
import { AFTER_FIRST_SLOT, DAY, pickOption, runSweep, sendNow, signIn } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

const QUESTIONS = ["Q1", "Q2", "Q3", "Q4", "Q5"];

test.beforeEach(async () => {
  await resetDatabase();
});

/** The queue: the pool's turn-takers in the order coming rounds take them. */
function queue(groupId: string) {
  return rows<{ text: string }>("select text from questions where group_id = $1 order by position", [groupId])
    .then((result) => result.map((row) => row.text));
}

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
  await openPlan(page);
  // Choosing a count in Up next saves it.
  await pickOption(page, copy.questions.upNext.countLabel, "2");
  await expect(page.getByText(copy.questions.done.count)).toBeVisible();

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

  // What each round took went to the back: the queue is the order from here on.
  expect(await queue(loop.groupId)).toEqual(["Q2", "Q3", "Q4", "Q5", "Q1"]);
  const [group] = await rows<{ questions_per_round: number }>("select questions_per_round from groups where id = $1", [loop.groupId]);
  expect(group.questions_per_round).toBe(2);
});

test("C5 · saving an unchanged count keeps the queue", async ({ page }) => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await rows("update questions set position = case text when 'Q4' then -1 when 'Q5' then -2 else position end where group_id = $1", [loop.groupId]);
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/questions`);
  await openPlan(page);
  // Choosing the count it already has still saves, and must leave the queue alone.
  await pickOption(page, copy.questions.upNext.countLabel, "2");
  await expect(page.getByText(copy.questions.done.count)).toBeVisible();

  expect(await queue(loop.groupId)).toEqual(["Q5", "Q4", "Q1", "Q2", "Q3"]);
});

test("C5 · send now uses the same rotation", async ({ page }) => {
  const loop = await seedLoop({ questions: QUESTIONS });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT);
  expect(await questionsForRound(loop.groupId, 1)).toEqual(["Q1", "Q2"]);
  const [first] = await rows<{ id: string }>("select id from issues where group_id = $1 and number = 1", [loop.groupId]);
  await seedReplies({ issueId: first.id, membershipId: loop.members[1].id, answers: [{ text: "Q1", body: "Answer" }] });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/issues`);
  await sendNow(page);
  await expect(page.getByText(copyText(copy.rounds.sentNotice, { number: "1", next: "2" }))).toBeVisible();

  expect(await questionsForRound(loop.groupId, 2)).toEqual(["Q3", "Q4"]);
  expect(await queue(loop.groupId)).toEqual(["Q5", "Q1", "Q2", "Q3", "Q4"]);
});

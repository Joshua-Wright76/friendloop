import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { seedPoll } from "../support/polls";
import { AFTER_FIRST_SLOT, runSweep, waitForSheet } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("L2 · a contributor taps to answer, changes their mind, and never sees a partial tally", async ({ page, request }) => {
  const loop = await seedLoop({ questions: ["What made you laugh this week?"] });
  await seedPoll(loop, { text: "Where should we camp?", options: ["The lake", "The mountains", "The coast"] });
  await seedPoll(loop, { text: "Which weekends work?", options: ["June", "July", "August"], multiple: true });
  await runSweep(AFTER_FIRST_SLOT);

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const [{ id: issueId }] = await rows<{ id: string }>("select id from issues limit 1");

  // Bob has already voted: Alice must not be able to tell.
  const [{ id: campId }] = await rows<{ id: string }>("select id from issue_questions where text = 'Where should we camp?'");
  const bobVote = await request.post(`/api/reply/${bob.token}`, {
    data: { action: "pollChoice", issueQuestionId: campId, choices: [0] },
  });
  expect(bobVote.status()).toBe(200);

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);

  const camp = page.getByRole("group", { name: "Where should we camp?" });
  const campCard = page.locator("section", { has: camp });
  await expect(camp.getByText(copy.polls.sheet.single)).toBeVisible();
  await expect(campCard.getByText(copy.polls.sheet.hidden)).toBeVisible();

  // Tap, change, reload: the last pick is the one that sticks.
  await camp.getByLabel("The lake").check();
  await expect(campCard.getByText(copy.polls.sheet.saved)).toBeVisible();
  await camp.getByLabel("The coast").check();
  await expect(camp.getByLabel("The lake")).not.toBeChecked();
  await expect(campCard.getByText(copy.polls.sheet.saved)).toBeVisible();
  await page.reload();
  await waitForSheet(page);
  await expect(camp.getByLabel("The coast")).toBeChecked();

  // Clearing is allowed until the round goes out.
  await campCard.getByRole("button", { name: copy.polls.sheet.clear }).click();
  await expect(campCard.getByText(copy.polls.sheet.cleared)).toBeVisible();
  await expect(camp.getByLabel("The coast")).not.toBeChecked();
  await camp.getByLabel("The mountains").check();

  // A multiple-choice poll takes several.
  const weekends = page.getByRole("group", { name: "Which weekends work?" });
  const weekendsCard = page.locator("section", { has: weekends });
  await expect(weekends.getByText(copy.polls.sheet.multiple)).toBeVisible();
  await weekends.getByLabel("June").check();
  await weekends.getByLabel("August").check();
  await expect(weekends.getByLabel("June")).toBeChecked();
  await expect(weekends.getByLabel("August")).toBeChecked();
  await weekends.getByLabel("June").uncheck();
  await expect(weekends.getByLabel("June")).not.toBeChecked();
  await expect(weekendsCard.getByText(copy.polls.sheet.saved)).toBeVisible();

  // Nothing on the sheet counts anyone else's votes.
  await expect(page.getByText(/\b\d+ votes?\b/)).toHaveCount(0);
  await expect(page.getByText(copy.polls.issue.results, { exact: true })).toHaveCount(0);

  await expect(page.getByText(copyText(copy.reply.answered, { answered: "2", total: "3" })).first()).toBeVisible();
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  const [row] = await rows<{ poll_choices: number[] }>(
    "select poll_choices from replies where issue_question_id = $1 and membership_id = $2",
    [campId, alice.id],
  );
  expect(row).toEqual({ poll_choices: [1] });

  // Before delivery the web issue hands out no tally, and no one else's pick.
  await page.goto(`/i/${issueId}?m=${alice.token}`);
  await expect(page.getByRole("heading", { name: copyText(copy.issue.round, { number: 1 }) })).toBeVisible();
  await expect(page.getByText(copy.polls.issue.results)).toHaveCount(0);
  await expect(page.getByText("Bob", { exact: true })).toHaveCount(0);
  await expect(page.getByText("The mountains").first()).toBeVisible();

  // The server refuses what the sheet could never send.
  const tooMany = await request.post(`/api/reply/${alice.token}`, {
    data: { action: "pollChoice", issueQuestionId: campId, choices: [0, 1] },
  });
  expect(tooMany.status()).toBe(400);
  expect((await tooMany.json()).error).toBe(copy.polls.errors.choices);
});

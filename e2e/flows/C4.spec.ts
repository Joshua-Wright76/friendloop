import { test, expect, type Page } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, addWithCard, freezeClock, openItem, runSweep, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const thisRound = (page: Page) => page.getByRole("list", { name: "What this round asks, in order" });
const asked = () => rows<{ text: string }>("select text from issue_questions order by position").then((found) => found.map((row) => row.text));

test("C4 · the owner edits this round directly: remove, reorder, add, and reword in place", async ({ page }) => {
  const loop = await seedLoop({ questions: ["Q1", "Q2", "Q3", "Q4"] });
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await runSweep(AFTER_FIRST_SLOT);
  const [round] = await rows<{ id: string }>("select id from issues where number = 1");
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: round.id, membershipId: alice.id, answers: [{ text: "Q1", body: "Mine." }] });
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);

  // Someone wrote in Q1: it says who, and offers no bin.
  const first = thisRound(page).locator(":scope > li").first();
  await expect(first).toContainText("Alice has written here, so it stays");
  await expect(page.getByRole("button", { name: "Remove from this round: Q1" })).toHaveCount(0);

  // Q2 comes out, and goes first in line for the next round.
  await page.getByRole("button", { name: "Remove from this round: Q2" }).click();
  await expect(page.getByText("Removed from this round. It's first in line for the next one.")).toBeVisible();
  expect(await asked()).toEqual(["Q1"]);
  const queue = await rows<{ text: string }>("select text from questions order by position");
  expect(queue.map((row) => row.text)).toEqual(["Q2", "Q3", "Q4", "Q1"]);

  // "Add to this round" takes the owner to the add card, asking for this round.
  await page.getByRole("button", { name: "Add to this round" }).click();
  await expect(page.getByLabel("Ask it this round too")).toBeChecked();
  await expect(page.getByLabel(/^What to ask/)).toBeFocused();
  await addWithCard(page, { text: "The potluck corner", frequency: "Every round" });
  // And one from Up next, asked now too.
  const q4 = await openItem(page, "Q4");
  await q4.getByRole("button", { name: "Ask this round too: Q4" }).click();
  await expect.poll(asked).toEqual(["Q1", "The potluck corner", "Q4"]);
  await expect(page.getByText("Added to this round.")).toBeVisible();

  // Reordered by the grip: this round only.
  await thisRound(page).getByRole("button", { name: "Move: Q4" }).click();
  await page.getByRole("button", { name: "Move up: Q4" }).click();
  await expect.poll(asked).toEqual(["Q1", "Q4", "The potluck corner"]);

  // Reworded in place: this round reads the new words while nobody has written there…
  const corner = await openItem(page, "The potluck corner");
  await corner.getByLabel(/^What to ask/).fill("The supper club");
  await corner.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(await asked()).toEqual(["Q1", "Q4", "The supper club"]);

  // …and keeps the words someone answered once they have.
  const [club] = await rows<{ id: string }>("select id from issue_questions where text = 'The supper club'");
  await rows("insert into replies (issue_id, issue_question_id, membership_id, body, status) values ($1, $2, $3, 'Pasta.', 'submitted')", [round.id, club.id, alice.id]);
  await page.reload();
  const again = await openItem(page, "The supper club");
  await again.getByLabel(/^What to ask/).fill("Bring a dish");
  await again.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  expect(await asked()).toEqual(["Q1", "Q4", "The supper club"]);
  const [pool] = await rows<{ text: string }>("select text from questions where frequency = 'every_round'");
  expect(pool.text).toBe("Bring a dish");
});

test("C4 · a date taken out of this round stays out, and a paused loop says edits wait for it", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("insert into questions (group_id, text, frequency, format, active, date_kind, month, day, about_membership_id) values ($1, '', 'on_date', 'written', false, 'birthday', 1, 6, $2)", [loop.groupId, alice.id]);
  await runSweep(AFTER_FIRST_SLOT);
  await rows("update groups set paused_at = $1 where id = $2", [AFTER_FIRST_SLOT.toISOString(), loop.groupId]);
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByText("This loop is paused. Changes here apply when it resumes.")).toBeVisible();

  await page.getByRole("button", { name: "Remove from this round: Alice's birthday" }).click();
  await expect(page.getByText("Removed from this round.")).toBeVisible();
  const [birthday] = await rows<{ skipped: string }>("select skipped_dates::text as skipped from questions where frequency = 'on_date'");
  expect(birthday.skipped).toBe("{2026-01-06}");
  await expect(thisRound(page)).not.toContainText("Alice's birthday");
});

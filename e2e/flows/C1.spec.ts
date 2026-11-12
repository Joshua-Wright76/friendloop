import { test, expect } from "../support/test";
import { db } from "@/db";
import { memberships } from "@/db/schema";
import { newToken } from "@/lib/tokens";
import { latestOutbox, resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { openPlan } from "../support/questions";
import { AFTER_FIRST_SLOT, addCard, addWithCard, freezeClock, runSweep, signIn } from "../support/harness";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const LAUGH = "What made you laugh this week?";
const AHEAD = "What are you looking forward to?";

async function addReader(groupId: string) {
  const token = newToken();
  const [row] = await db
    .insert(memberships)
    .values({ groupId, email: "rita@friendloop.test", name: "Rita", participation: "reader", replyToken: token, acceptedAt: new Date("2026-01-01T00:00:00Z") })
    .returning();
  return { id: row.id, token };
}

const thisRound = (page: import("@playwright/test").Page) => page.getByRole("list", { name: copy.questions.thisRound.listLabel });
const turns = (page: import("@playwright/test").Page) => page.getByRole("list", { name: copy.questions.upNext.turnsLabel });

test("C1 · one add card adds any kind of item, and each lands where its frequency puts it", async ({ page }) => {
  const loop = await seedLoop();
  await runSweep(AFTER_FIRST_SLOT);
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(thisRound(page).locator(":scope > li")).toHaveCount(2);

  // A question that takes turns waits at the back of Up next.
  // (The add card asks for this round by default, so this one says it is for later.)
  await addWithCard(page, { text: "What did you learn this week?", thisRound: false });
  await expect(page.getByText(copy.questions.done.added)).toBeVisible();
  await openPlan(page);
  await expect(turns(page).locator(":scope > li").last()).toContainText("What did you learn this week?");
  await expect(thisRound(page)).not.toContainText("What did you learn this week?");

  // One asked this round too goes last in This round.
  await addWithCard(page, { text: "Tea or coffee?", format: copy.questions.item.formats.poll, options: ["Tea", "Coffee"], thisRound: true });
  await expect(page.getByText(copy.questions.done.addedNow)).toBeVisible();
  await expect(thisRound(page).locator(":scope > li").last()).toContainText("Tea or coffee?");

  // An every-round photo wall joins this round at once, with its emoji and description.
  await addWithCard(page, { text: "The fridge wall", format: copy.questions.item.formats.photo_wall, frequency: copy.questions.item.frequencies.every_round, emoji: "🧲", description: "Whatever's on yours" });
  await expect(thisRound(page)).toContainText("The fridge wall");
  await openPlan(page);
  await expect(page.getByRole("list", { name: copy.questions.upNext.everyRoundLabel })).toContainText(copy.questions.item.formats.photo_wall);

  // A birthday in this round's days joins it too, titled with the person's name.
  await addWithCard(page, { frequency: copy.questions.item.frequencies.on_date, dateKind: copy.questions.item.dateKinds.birthday, person: "Alice", date: "1990-01-06" });
  await expect(thisRound(page).locator(":scope > li").last()).toContainText(copyText(copy.events.birthdayRow, { name: "Alice" }));
  await openPlan(page);
  await expect(page.getByRole("list", { name: copy.questions.upNext.datedLabel })).toContainText(copyText(copy.events.birthdayRow, { name: "Alice" }));
  await expect(page.getByRole("list", { name: copy.questions.upNext.datedLabel })).toContainText(copy.questions.upNext.inThisRound);

  const stored = await rows<{ text: string; format: string; frequency: string; emoji: string | null; description: string | null }>(
    "select text, format, frequency, emoji, description from questions where group_id = $1 order by text", [loop.groupId]);
  expect(stored.map((row) => ({ ...row }))).toEqual([
    { text: "", format: "written", frequency: "on_date", emoji: null, description: null },
    { text: "Tea or coffee?", format: "poll", frequency: "rotating", emoji: null, description: null },
    { text: "The fridge wall", format: "photo_wall", frequency: "every_round", emoji: "🧲", description: "Whatever's on yours" },
    { text: AHEAD, format: "written", frequency: "rotating", emoji: null, description: null },
    { text: "What did you learn this week?", format: "written", frequency: "rotating", emoji: null, description: null },
    { text: LAUGH, format: "written", frequency: "rotating", emoji: null, description: null },
  ].sort((left, right) => left.text.localeCompare(right.text)));
  expect(stored.map((row) => row.text)).toEqual([
    "", "Tea or coffee?", "The fridge wall", AHEAD, "What did you learn this week?", LAUGH,
  ].sort((left, right) => left.localeCompare(right)));
  const asked = await rows<{ text: string }>("select text from issue_questions order by position");
  expect(asked.map((row) => row.text)).toEqual([LAUGH, AHEAD, "Tea or coffee?", "The fridge wall", copyText(copy.events.birthdayRow, { name: "Alice" })]);
});

test("C1 · a refused item says what to fix", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);
  const card = addCard(page);
  const { fillItem } = await import("../support/harness");
  await fillItem(page, card, { text: "Last week's party", frequency: copy.questions.item.frequencies.on_date, date: "2025-12-20" });
  await card.getByRole("button", { name: copy.questions.add.submit, exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: copy.questions.errors.pastDate })).toBeVisible();
  expect(await rows("select 1 from questions where frequency = 'on_date'")).toHaveLength(0);
});

test("C1 · every format reaches the round's sheet and issue; readers read but never answer", async ({ page }) => {
  const loop = await seedLoop();
  const reader = await addReader(loop.groupId);
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await addWithCard(page, { text: "The potluck corner", frequency: copy.questions.item.frequencies.every_round });

  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  // One list: the every-round item follows the round's turn-takers.
  const cards = await page.getByRole("heading", { level: 2 }).allInnerTexts();
  expect(cards.indexOf("The potluck corner")).toBeGreaterThan(cards.indexOf(AHEAD));
  await page.getByRole("textbox", { name: "The potluck corner" }).fill("Never too many dips.");
  await page.getByRole("button", { name: copy.reply.done, exact: true }).click();
  await expect(page.getByRole("heading", { name: copy.reply.confirmation.title, exact: true })).toBeVisible();

  await runSweep(new Date("2026-01-09T09:00:00Z"));
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");
  await page.goto(`/i/${issue.id}?m=${alice.token}`);
  await expect(page.getByText("Never too many dips.")).toBeVisible();
  await page.goto(`/i/${issue.id}?m=${reader.token}`);
  await expect(page.getByText("Never too many dips.")).toBeVisible();
  const email = await latestOutbox("delivery:");
  expect(email.html).toContain("The potluck corner");
});

test("C1 · a round that holds only every-round items still sends every contributor its prompt", async () => {
  const loop = await seedLoop({ questions: [] });
  await addReader(loop.groupId);
  await rows("insert into sections (group_id, kind, title, emoji) values ($1, 'photo_wall', 'Photo wall', '📸')", [loop.groupId]);

  await runSweep(new Date("2026-01-02T08:00:00Z"));
  const prompts = await rows<{ to: string; subject: string; text: string }>(
    "select \"to\", subject, text from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(prompts.map((row) => row.to)).toEqual(["alice@friendloop.test", "bob@friendloop.test", "owner@friendloop.test"]);
  for (const prompt of prompts) {
    expect(prompt.subject).toMatch(copyPattern(copy.emails.prompt.subject, { values: { questionCount: 1, plural: copy.emails.questionSingular, groupName: "Friday Loop" } }));
    expect(prompt.text).toContain("- 📸 Photo wall");
  }
});

import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, runSweep, signIn, inOrder } from "../support/harness";
import { copy, text as copyText, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("C7 · Up next shows which round asks each turn-taker, then every-round items and dates", async ({ page }) => {
  const loop = await seedLoop({
    questions: ["Q1", "Q2", "Q3", "Q4", "Q5"],
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "bob@friendloop.test", name: "Bob" },
    ],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("update groups set questions_per_round = 2 where id = $1", [loop.groupId]);
  await rows("insert into questions (group_id, text, frequency, format, active, position, emoji) values ($1, 'Fridge wall', 'rotating', 'photo_wall', false, 6, '🧲')", [loop.groupId]);
  await rows("insert into questions (group_id, text, frequency, format, active, position, admin_only) values ($1, 'Committee notes', 'rotating', 'written', true, 5, true)", [loop.groupId]);
  await rows("insert into questions (group_id, text, frequency, format, active, date_kind, month, day, about_membership_id) values ($1, '', 'on_date', 'written', false, 'birthday', 1, 20, $2)", [loop.groupId, alice.id]);
  await runSweep(AFTER_FIRST_SLOT); // round 1 asks Q1 and Q2
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);

  const queue = page.getByRole("list", { name: copy.questions.upNext.turnsLabel }).locator(":scope > li");
  await expect(queue).toHaveText([
    /Q3.*Round 2 · Fri 16 Jan/,
    inOrder("Q4", /.*/, copyText(copy.questions.upNext.roundTag, { number: 2, date: "Fri 16 Jan" })),
    inOrder("Q5", /.*/, copyText(copy.questions.upNext.roundTag, { number: 3, date: "Fri 23 Jan" })),
    inOrder("Committee notes", /.*/, copy.questions.item.adminOnlyTag),
    inOrder("Fridge wall", /.*/, copy.questions.item.formats.photo_wall),
    inOrder("Q1", /.*/, copyText(copy.questions.upNext.roundTag, { number: 4, date: "Fri 30 Jan" })),
    inOrder("Q2", /.*/, copyText(copy.questions.upNext.roundTag, { number: 5, date: "Fri 6 Feb" })),
  ]);
  await expect(page.getByRole("button", { name: `${copy.questions.upNext.countLabel}: 2` })).toBeVisible();
  await expect(page.getByRole("list", { name: copy.questions.upNext.datedLabel })).toContainText(inOrder(copyText(copy.events.birthdayRow, { name: "Alice" }), /.*/, `Tue, Jan 20 · ${copy.questions.upNext.yearly} · ${copyText(copy.questions.upNext.roundShort, { number: 3 })}`));

  // A member reads what they could be asked, and changes nothing.
  await page.context().clearCookies();
  await signIn(page, "alice@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByRole("heading", { name: copy.questions.thisRound.title })).toBeVisible();
  await expect(page.getByText("Fridge wall").first()).toBeVisible();
  await expect(page.getByText("Committee notes")).toHaveCount(0);
  await expect(page.getByText(copyText(copy.events.birthdayRow, { name: "Alice" }))).toHaveCount(0);
  await expect(page.getByRole("button", { name: copyPattern(copy.reorder.gripLabel, { start: true }) })).toHaveCount(0);
  await expect(page.getByRole("button", { name: copyPattern(`${copy.questions.item.editPrefix} `, { start: true }) })).toHaveCount(0);
  await expect(page.getByRole("region", { name: copy.questions.add.title })).toHaveCount(0);
});

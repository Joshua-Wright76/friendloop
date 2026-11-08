import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, freezeClock, runSweep, signIn } from "../support/harness";

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
  await rows("insert into questions (group_id, text, frequency, format, active, position, emoji) values ($1, 'Fridge wall', 'every_round', 'photo_wall', false, 0, '🧲')", [loop.groupId]);
  await rows("insert into questions (group_id, text, frequency, format, active, position, admin_only) values ($1, 'Committee notes', 'every_round', 'written', true, 1, true)", [loop.groupId]);
  await rows("insert into questions (group_id, text, frequency, format, active, date_kind, month, day, about_membership_id) values ($1, '', 'on_date', 'written', false, 'birthday', 1, 20, $2)", [loop.groupId, alice.id]);
  await runSweep(AFTER_FIRST_SLOT); // round 1 asks Q1 and Q2
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, AFTER_FIRST_SLOT);
  await page.goto(`/g/${loop.groupId}/questions`);

  const queue = page.getByRole("list", { name: "Questions that take turns, in the order rounds ask them" }).locator(":scope > li");
  await expect(queue).toHaveText([
    /Q3.*Round 2 · Fri 16 Jan/,
    /Q4.*Round 2 · Fri 16 Jan/,
    /Q5.*Round 3 · Fri 23 Jan/,
    /Q1.*Round 3 · Fri 23 Jan/,
    /Q2.*Round 4 · Fri 30 Jan/,
  ]);
  await expect(page.getByRole("button", { name: "Questions per round: 2" })).toBeVisible();
  const everyRound = page.getByRole("list", { name: "Asked every round, in order" }).locator(":scope > li");
  await expect(everyRound).toHaveText([/Fridge wall.*Photo wall/, /Committee notes.*Owner and admins/]);
  await expect(page.getByRole("list", { name: "Events and birthdays, soonest first" })).toContainText(/Alice's birthday.*Tue, Jan 20 · every year · Round 3/);

  // A member reads what they could be asked, and changes nothing.
  await page.context().clearCookies();
  await signIn(page, "alice@friendloop.test");
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByRole("heading", { name: "This round asks" })).toBeVisible();
  await expect(page.getByText("Fridge wall").first()).toBeVisible();
  await expect(page.getByText("Committee notes")).toHaveCount(0);
  await expect(page.getByText("Alice's birthday")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move: / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Add something to ask" })).toHaveCount(0);
});

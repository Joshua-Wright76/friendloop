import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { E2E_NOW, addCard, addWithCard, fillItem, freezeClock, openItem, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("O1 · the owner adds a birthday and a one-time event and sees them coming up", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, E2E_NOW); // 2 Jan 2026 in the loop
  await page.goto(`/g/${loop.groupId}/questions`);

  const dates = page.getByRole("list", { name: "Events and birthdays, soonest first" });
  await expect(page.getByText("No events or birthdays yet.")).toBeVisible();

  // A birthday: a member, a date, an emoji. The year doesn't matter.
  await addWithCard(page, { frequency: "On a date", dateKind: "A birthday, every year", person: "Alice", date: "1990-01-06", emoji: "🎂" });
  // A one-time event, further out.
  await addWithCard(page, { text: "The housewarming", frequency: "On a date", date: "2026-02-14", emoji: "🏡" });

  // Soonest first, with the next date and the yearly note on the birthday.
  const items = dates.locator(":scope > li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Alice's birthday");
  await expect(items.nth(0)).toContainText("Tue, Jan 6 · every year");
  await expect(items.nth(1)).toContainText("The housewarming");
  await expect(items.nth(1)).toContainText("Sat, Feb 14");

  const stored = await rows<{ kind: string; title: string | null; month: number; day: number; year: number | null; emoji: string | null }>(
    "select date_kind as kind, nullif(text, '') as title, month, day, year, emoji from questions where frequency = 'on_date' order by month",
  );
  expect(stored.map((row) => ({ ...row }))).toEqual([
    { kind: "birthday", title: null, month: 1, day: 6, year: null, emoji: "🎂" },
    { kind: "once", title: "The housewarming", month: 2, day: 14, year: 2026, emoji: "🏡" },
  ]);

  // Edited in place, then stopped.
  const party = await openItem(page, "The housewarming");
  await party.getByLabel(/^What to ask/).fill("The big housewarming");
  await party.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await expect(items.nth(1)).toContainText("The big housewarming");

  const big = await openItem(page, "The big housewarming");
  await big.getByRole("button", { name: "Stop asking: The big housewarming" }).click();
  await big.getByRole("button", { name: "Yes, stop asking" }).click(); // stopping asks first
  await expect(page.getByText(/^Stopped asking/)).toBeVisible();
  await expect(items).toHaveCount(1);

  // A date that has already gone by is refused, and the page says so.
  const card = addCard(page);
  await fillItem(page, card, { text: "Last week's party", frequency: "On a date", date: "2025-12-20" });
  await card.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("That date has already gone by.")).toBeVisible();
  await expect(items).toHaveCount(1);
});

test("O1 · only people who manage the loop see the dates", async ({ page }) => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "admin@friendloop.test", name: "Ada", access: "admin" },
    ],
  });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("insert into questions (group_id, text, frequency, format, active, date_kind, month, day, about_membership_id) values ($1, '', 'on_date', 'written', false, 'birthday', 3, 1, $2)", [loop.groupId, alice.id]);

  await signIn(page, "alice@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "On a date" })).toHaveCount(0);
  await expect(page.getByText("Alice's birthday")).toHaveCount(0);

  await page.context().clearCookies();
  await page.setExtraHTTPHeaders({});
  await signIn(page, "admin@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByRole("list", { name: "Events and birthdays, soonest first" })).toContainText("Alice's birthday");
});

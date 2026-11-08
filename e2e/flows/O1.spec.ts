import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { E2E_NOW, freezeClock, openPart, pickOption, signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("O1 · the owner adds a birthday and a one-time event and sees them coming up", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await freezeClock(page, E2E_NOW); // 2 Jan 2026 in the loop
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");

  const panel = page.getByRole("region", { name: "Events and birthdays" });
  await expect(panel.getByText("Nothing on the calendar yet.")).toBeVisible();
  const add = panel.locator("form").filter({ has: page.getByRole("button", { name: "Add event" }) });

  // A birthday: a member, a date, an emoji. The year doesn't matter.
  await pickOption(page, "Whose birthday?", "Alice");
  await add.getByLabel("Date").fill("1990-01-06");
  await add.getByLabel("Icon").fill("🎂");
  await add.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByText("Event added.")).toBeVisible();

  // A one-time event, further out.
  await pickOption(page, "Type of event", "One-time event");
  await add.getByLabel("What's the occasion?").fill("The housewarming");
  await add.getByLabel("Date").fill("2026-02-14");
  await add.getByLabel("Icon").fill("🏡");
  await add.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByText("Event added.")).toBeVisible();

  // Soonest first, with the next date and the yearly note on the birthday.
  const items = panel.getByRole("list", { name: "Events, soonest first" }).locator("> li");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("Alice's birthday");
  await expect(items.nth(0)).toContainText("Tue, Jan 6");
  await expect(items.nth(0)).toContainText("Every year");
  await expect(items.nth(1)).toContainText("The housewarming");
  await expect(items.nth(1)).toContainText("Sat, Feb 14");

  const stored = await rows<{ kind: string; title: string | null; month: number; day: number; year: number | null; emoji: string | null }>(
    "select date_kind as kind, nullif(text, '') as title, month, day, year, emoji from questions where frequency = 'on_date' order by month",
  );
  expect(stored).toEqual([
    { kind: "birthday", title: null, month: 1, day: 6, year: null, emoji: "🎂" },
    { kind: "once", title: "The housewarming", month: 2, day: 14, year: 2026, emoji: "🏡" },
  ]);

  // Edit and remove.
  await items.nth(1).getByText("Edit").click();
  await items.nth(1).getByLabel("What's the occasion?").fill("The big housewarming");
  await items.nth(1).getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Event saved.")).toBeVisible();
  await expect(items.nth(1)).toContainText("The big housewarming");

  await items.nth(1).getByRole("button", { name: "Remove The big housewarming" }).click();
  await items.nth(1).getByRole("button", { name: /^Yes, remove/ }).click(); // removing asks first
  await expect(page.getByText("Event removed.")).toBeVisible();
  await expect(items).toHaveCount(1);

  // A date that has already gone by is refused, and the form says so.
  await pickOption(page, "Type of event", "One-time event");
  await add.getByLabel("What's the occasion?").fill("Last week's party");
  await add.getByLabel("Date").fill("2025-12-20");
  await add.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByText("That date has already gone by.")).toBeVisible();
  await expect(items).toHaveCount(1);
});

test("O1 · only people who manage the loop see the calendar", async ({ page }) => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "admin@friendloop.test", name: "Ada", access: "admin" },
    ],
  });

  await signIn(page, "alice@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByRole("heading", { name: "Questions", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Events and birthdays" })).toHaveCount(0);

  await page.context().clearCookies();
  await page.setExtraHTTPHeaders({});
  await signIn(page, "admin@friendloop.test");
  await freezeClock(page, E2E_NOW);
  await page.goto(`/g/${loop.groupId}/questions`);
  await openPart(page, "Sections and dates");
  await expect(page.getByRole("region", { name: "Events and birthdays" })).toBeVisible();
});

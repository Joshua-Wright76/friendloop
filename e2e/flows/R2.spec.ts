import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase } from "../support/db";
import { pickOption, signIn, unfold } from "../support/harness";

/** The reading controls live in the issue bar, folded under who and in what order. */
const openReading = (page: import("@playwright/test").Page) => unfold(page, /by (question|person)$/i);
import { seedReading } from "../support/reading";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("R2 · the rounds list narrows to the rounds one person answered in, and reading opens on their answers", async ({ page }) => {
  const world = await seedReading();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/issues`);

  // Everything is listed until somebody is chosen.
  for (const number of [1, 2, 3]) await expect(page.getByText(text(copy.rounds.round, { number }), { exact: true })).toBeVisible();

  await unfold(page, copy.rounds.filter.summary);
  await pickOption(page, copy.rounds.filter.label, "Alice");
  await expect(page).toHaveURL(new RegExp(`member=${world.alice.id}`));
  await expect(page.getByText(text(copy.rounds.filter.showing, { name: "Alice" }))).toBeVisible();
  await expect(page.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toBeVisible();
  await expect(page.getByText(text(copy.rounds.round, { number: 2 }), { exact: true })).toHaveCount(0);
  await expect(page.getByText(text(copy.rounds.round, { number: 3 }), { exact: true }), "an open round is not a delivered one").toHaveCount(0);

  // Reading lands on that person's answers.
  await page.getByRole("link", { name: copyPattern(copy.rounds.read, { start: true }) }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${world.first.issueId}\\?by=${world.alice.id}`));
  await expect(page.getByText("Alice on the goose.")).toBeVisible();
  await expect(page.getByText("Alice looks forward to soup.")).toBeVisible();
  await expect(page.getByText("Alice fixed the gate.")).toBeVisible();
  await expect(page.getByText("Bob on the goose.")).toHaveCount(0);
  await expect(page.getByText(text(copy.issue.reading.showing, { name: "Alice" }))).toBeVisible();

  // And the way back is a plain link.
  await page.getByRole("link", { name: copy.issue.reading.showEveryone }).click();
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toBeVisible();
});

test("R2 · a person with no delivered answers gets a plain empty list and a way out", async ({ page }) => {
  const world = await seedReading();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/issues?member=${world.alice.id}`);
  await pickOption(page, copy.rounds.filter.label, "Sam");

  await expect(page.getByText(text(copy.rounds.filter.empty, { name: "Sam" }))).toBeVisible();
  await expect(page.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: copy.rounds.filter.clear }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${world.loop.groupId}/issues$`));
  await expect(page.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toBeVisible();

  // A made-up or foreign id in the address is the same as no filter.
  await page.goto(`/g/${world.loop.groupId}/issues?member=not-a-person`);
  await expect(page.getByText(text(copy.rounds.round, { number: 2 }), { exact: true })).toBeVisible();
  await page.goto(`/g/${world.loop.groupId}/issues?member=99999999-9999-4999-8999-999999999999`);
  await expect(page.getByText(text(copy.rounds.round, { number: 2 }), { exact: true })).toBeVisible();
  await expect(page.getByText(copyPattern(copy.rounds.filter.showing))).toHaveCount(0);
});

test("R2 · inside a round, one person's answers can be isolated and the round can be read by person", async ({ page }) => {
  const world = await seedReading();
  const path = `/i/${world.first.issueId}?m=${world.alice.token}`;
  await page.goto(path);

  await openReading(page);
  const controls = page.getByRole("navigation", { name: copy.issue.reading.label });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("link", { name: new RegExp(`^(✓ )?${copyPattern(copy.issue.reading.everyone).source}$`) })).toHaveAttribute("aria-current", "true");
  await expect(controls.getByRole("link", { name: copyPattern(copy.issue.reading.byQuestion) })).toHaveAttribute("aria-current", "true");

  // Isolate Bob: his name carries the check, the others' answers leave.
  await controls.getByRole("link", { name: "Bob" }).click();
  await expect(page).toHaveURL(new RegExp(`by=${world.bob.id}`));
  await expect(page).toHaveURL(/m=/);
  await openReading(page);
  await expect(controls.getByRole("link", { name: /Bob/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Bob looks forward to a nap.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toHaveCount(0);
  await expect(page.getByText("Small wins"), "a section Bob skipped is not shown").toHaveCount(0);

  // Read by person: one card per author, in name order, every answer under its question.
  await openReading(page);
  await controls.getByRole("link", { name: copy.issue.reading.everyoneLower, exact: true }).click();
  // Let the isolation clear before choosing the sort: the sort link is built from the page it was clicked on.
  await expect(page).not.toHaveURL(/by=/);
  await openReading(page);
  await controls.getByRole("link", { name: copy.issue.reading.byPerson }).click();
  await openReading(page);
  await expect(controls.getByRole("link", { name: copyPattern(copy.issue.reading.byPerson) })).toHaveAttribute("aria-current", "true");
  const people = page.locator("section[aria-label] > h2");
  // The avatar's initial rides in the text but is hidden from assistive tech.
  await expect(people).toHaveText([/^A?Alice$/, /^B?Bob$/]);
  const aliceCard = page.getByRole("region", { name: "Alice" });
  await expect(aliceCard.getByRole("heading", { level: 3 })).toHaveText([
    copy.questionPacks[0].questions[0],
    copy.questionPacks[0].questions[1],
    "🏆 Small wins",
  ]);
  await expect(aliceCard.getByText("Alice fixed the gate.")).toBeVisible();
  await expect(aliceCard.getByText("Bob on the goose.")).toHaveCount(0);

  // One person, by person: a single card.
  await openReading(page);
  await controls.getByRole("link", { name: "Bob" }).click();
  await expect(page.locator("section[aria-label] > h2")).toHaveText([/^B?Bob$/]);

  // The default view is exactly what it was: question headings, both authors under each.
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 2, name: copyPattern(copy.questionPacks[0].questions[0]) })).toBeVisible();
});

test("R2 · a person who did not write in the round, or a bad address, reads as everyone; shares and prints stay whole", async ({ page }) => {
  const world = await seedReading();
  await page.goto(`/i/${world.second.issueId}?m=${world.alice.token}&by=${world.alice.id}`);
  // Alice wrote nothing in round two, so there is nobody to isolate.
  await expect(page.getByText("Bob alone in round two.")).toBeVisible();
  await expect(page.getByText(copyPattern(copy.issue.reading.showing))).toHaveCount(0);

  await page.goto(`/i/${world.first.issueId}?m=${world.alice.token}&by=nonsense&sort=sideways`);
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toBeVisible();

  // The print view is the whole round whatever you were looking at.
  await page.goto(`/i/${world.first.issueId}?print&m=${world.alice.token}&by=${world.alice.id}`);
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: copy.issue.reading.label })).toHaveCount(0);
});

test("R2 · the reading controls pass the accessibility audit in both colour schemes", async ({ page }) => {
  const world = await seedReading();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const query of ["", `&by=${world.bob.id}`, "&sort=member"]) {
      await page.goto(`/i/${world.first.issueId}?m=${world.alice.token}${query}`);
      // Audited with the controls open, so they are what gets measured.
      await openReading(page);
      await expect(page.getByRole("navigation", { name: copy.issue.reading.label })).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map((violation) => `${violation.id} ${violation.nodes.map((n) => n.target).join(" ")}`), `${scheme} ${query}`).toEqual([]);
    }
  }
});

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { resetDatabase } from "../support/db";
import { signIn } from "../support/harness";
import { seedReading } from "../support/reading";

test.beforeEach(async () => {
  await resetDatabase();
});

test("R2 · the rounds list narrows to the rounds one person answered in, and reading opens on their answers", async ({ page }) => {
  const world = await seedReading();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/issues`);

  // Everything is listed until somebody is chosen.
  for (const name of ["Round 1", "Round 2", "Round 3"]) await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.getByLabel("Rounds with answers from").selectOption({ label: "Alice" });
  await page.getByRole("button", { name: "Show rounds" }).click();
  await expect(page).toHaveURL(new RegExp(`member=${world.alice.id}`));
  await expect(page.getByText("Showing rounds Alice answered in.")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Round 2", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Round 3", { exact: true }), "an open round is not a delivered one").toHaveCount(0);

  // "Read it" lands on that person's answers.
  await page.getByRole("link", { name: "Read it" }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${world.first.issueId}\\?by=${world.alice.id}`));
  await expect(page.getByText("Alice on the goose.")).toBeVisible();
  await expect(page.getByText("Alice looks forward to soup.")).toBeVisible();
  await expect(page.getByText("Alice fixed the gate.")).toBeVisible();
  await expect(page.getByText("Bob on the goose.")).toHaveCount(0);
  await expect(page.getByText("Showing only Alice's answers.")).toBeVisible();

  // And the way back is a plain link.
  await page.getByRole("link", { name: "Show everyone" }).click();
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toBeVisible();
});

test("R2 · a person with no delivered answers gets a plain empty list and a way out", async ({ page }) => {
  const world = await seedReading();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${world.loop.groupId}/issues?member=${world.alice.id}`);
  await page.getByLabel("Rounds with answers from").selectOption({ label: "Sam" });
  await page.getByRole("button", { name: "Show rounds" }).click();

  await expect(page.getByText("Sam hasn't answered in a delivered round yet.")).toBeVisible();
  await expect(page.getByText("Round 1", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Show every round" }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${world.loop.groupId}/issues$`));
  await expect(page.getByText("Round 1", { exact: true })).toBeVisible();

  // A made-up or foreign id in the address is the same as no filter.
  await page.goto(`/g/${world.loop.groupId}/issues?member=not-a-person`);
  await expect(page.getByText("Round 2", { exact: true })).toBeVisible();
  await page.goto(`/g/${world.loop.groupId}/issues?member=99999999-9999-4999-8999-999999999999`);
  await expect(page.getByText("Round 2", { exact: true })).toBeVisible();
  await expect(page.getByText(/answered in\./)).toHaveCount(0);
});

test("R2 · inside a round, one person's answers can be isolated and the round can be read by person", async ({ page }) => {
  const world = await seedReading();
  const path = `/i/${world.first.issueId}?m=${world.alice.token}`;
  await page.goto(path);

  const controls = page.getByRole("navigation", { name: "Reading this round" });
  await expect(controls).toBeVisible();
  await expect(controls.getByRole("link", { name: /^(✓ )?Everyone$/ })).toHaveAttribute("aria-current", "true");
  await expect(controls.getByRole("link", { name: /By question/ })).toHaveAttribute("aria-current", "true");

  // Isolate Bob: his name carries the check, the others' answers leave.
  await controls.getByRole("link", { name: "Bob" }).click();
  await expect(page).toHaveURL(new RegExp(`by=${world.bob.id}`));
  await expect(page).toHaveURL(/m=/);
  await expect(controls.getByRole("link", { name: /Bob/ })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Bob looks forward to a nap.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toHaveCount(0);
  await expect(page.getByText("Small wins"), "a section Bob skipped is not shown").toHaveCount(0);

  // Read by person: one card per author, in name order, every answer under its question.
  await controls.getByRole("link", { name: "Everyone", exact: true }).click();
  // Let the isolation clear before choosing the sort: the sort link is built from the page it was clicked on.
  await expect(page).not.toHaveURL(/by=/);
  await controls.getByRole("link", { name: "By person" }).click();
  await expect(controls.getByRole("link", { name: /By person/ })).toHaveAttribute("aria-current", "true");
  const people = page.locator("section[aria-label] > h2");
  // The avatar's initial rides in the text but is hidden from assistive tech.
  await expect(people).toHaveText([/^A?Alice$/, /^B?Bob$/]);
  const aliceCard = page.getByRole("region", { name: "Alice" });
  await expect(aliceCard.getByRole("heading", { level: 3 })).toHaveText([
    "What made you laugh this week?",
    "What are you looking forward to?",
    "🏆 Small wins",
  ]);
  await expect(aliceCard.getByText("Alice fixed the gate.")).toBeVisible();
  await expect(aliceCard.getByText("Bob on the goose.")).toHaveCount(0);

  // One person, by person: a single card.
  await controls.getByRole("link", { name: "Bob" }).click();
  await expect(page.locator("section[aria-label] > h2")).toHaveText([/^B?Bob$/]);

  // The default view is exactly what it was: question headings, both authors under each.
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 2, name: /What made you laugh this week\?/ })).toBeVisible();
});

test("R2 · a person who did not write in the round, or a bad address, reads as everyone; shares and prints stay whole", async ({ page }) => {
  const world = await seedReading();
  await page.goto(`/i/${world.second.issueId}?m=${world.alice.token}&by=${world.alice.id}`);
  // Alice wrote nothing in round two, so there is nobody to isolate.
  await expect(page.getByText("Bob alone in round two.")).toBeVisible();
  await expect(page.getByText(/Showing only/)).toHaveCount(0);

  await page.goto(`/i/${world.first.issueId}?m=${world.alice.token}&by=nonsense&sort=sideways`);
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByText("Alice on the goose.")).toBeVisible();

  // The print view is the whole round whatever you were looking at.
  await page.goto(`/i/${world.first.issueId}?print&m=${world.alice.token}&by=${world.alice.id}`);
  await expect(page.getByText("Bob on the goose.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Reading this round" })).toHaveCount(0);
});

test("R2 · the reading controls pass the accessibility audit in both colour schemes", async ({ page }) => {
  const world = await seedReading();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const query of ["", `&by=${world.bob.id}`, "&sort=member"]) {
      await page.goto(`/i/${world.first.issueId}?m=${world.alice.token}${query}`);
      await expect(page.getByRole("navigation", { name: "Reading this round" })).toBeVisible();
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(result.violations.map((violation) => `${violation.id} ${violation.nodes.map((n) => n.target).join(" ")}`), `${scheme} ${query}`).toEqual([]);
    }
  }
});

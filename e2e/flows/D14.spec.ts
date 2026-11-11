import { test, expect } from "../support/test";
import { resetDatabase } from "../support/db";
import { seedLoop, seedOpenIssue, seedReplies } from "../support/seed";
import { signIn } from "../support/harness";

import { copy, text as copyText, copyPattern } from "@/lib/copy";
test.beforeEach(async () => {
  await resetDatabase();
});

const OPENED = new Date("2026-01-02T08:00:00Z");
const LAUGH = "What made you laugh this week?";

test("D14 · the owner previews the open round with everyone's answers so far", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: OPENED });
  const [, alice, bob] = loop.members;
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: LAUGH, body: "A goose chased Dev." }] });
  await seedReplies({ issueId: issue.issueId, membershipId: bob.id, answers: [{ text: LAUGH, body: "Half a thought" }] });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}`);
  const round = page.locator('[aria-labelledby="this-round"]');
  await round.getByRole("link", { name: copy.loop.previewRound }).click();
  await expect(page).toHaveURL(new RegExp(`/i/${issue.issueId}$`));

  // Everyone's answers as they stand, half-finished ones included.
  await expect(page.getByText("A goose chased Dev.")).toBeVisible();
  await expect(page.getByText("Half a thought")).toBeVisible();
  const note = page.getByRole("note");
  await expect(note).toContainText(copy.issue.preview.note);
  // Read-only: nobody reacts to a draft.
  const buttons = page.locator("article.answer-card", { hasText: "A goose chased Dev." }).getByRole("button");
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) await expect(button).toBeDisabled();
  await note.getByRole("link", { name: copy.issue.preview.back }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));

  // Rounds offers the same preview beside the open round.
  await page.goto(`/g/${loop.groupId}/issues`);
  await expect(page.getByRole("link", { name: copyText(copy.a11yLabels.previewRound, { title: copyText(copy.rounds.round, { number: 1 }) }) })).toHaveAttribute("href", `/i/${issue.issueId}`);
});

test("D14 · a member gets no preview, and sees only their own answers", async ({ page }) => {
  const loop = await seedLoop({
    members: [
      { email: "alice@friendloop.test", name: "Alice" },
      { email: "bob@friendloop.test", name: "Bob" },
    ],
  });
  const issue = await seedOpenIssue(loop, { openedAt: OPENED });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: LAUGH, body: "A goose chased Dev." }] });
  await seedReplies({ issueId: issue.issueId, membershipId: bob.id, answers: [{ text: LAUGH, body: "Bob's secret" }] });

  await signIn(page, "alice@friendloop.test");
  await page.goto(`/g/${loop.groupId}`);
  await expect(page.locator('[aria-labelledby="this-round"]')).toBeVisible();
  await expect(page.getByRole("link", { name: copy.loop.previewRound })).toHaveCount(0);
  await page.goto(`/g/${loop.groupId}/issues`);
  await expect(page.getByRole("link", { name: copyPattern(copy.rounds.preview, { start: true }) })).toHaveCount(0);

  await page.goto(`/i/${issue.issueId}`);
  await expect(page.getByText("A goose chased Dev.")).toBeVisible();
  await expect(page.getByText("Bob's secret")).toHaveCount(0);
  await expect(page.getByRole("note")).toHaveCount(0);

  // The sheet says who can read an answer before it goes out.
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByText(copyPattern(copy.reply.goesOutNote))).toBeVisible();
});


import { test, expect, type Page } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop, seedOpenIssue, seedReplies } from "../support/seed";
import { signIn, waitForSheet } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const OPENED = new Date("2026-01-02T08:00:00Z");

/** Everything the browser was given: the markup and the inline React payload. */
async function served(page: Page): Promise<string> {
  return page.content();
}

test("D13 · the owner answers their own round from the app, then edits it", async ({ page }) => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: OPENED });
  const [owner, alice, bob] = loop.members;
  await signIn(page, owner.email);

  // Your loops: the card offers the round, on the owner's own link.
  const card = page.locator(".loop-card", { hasText: "Friday Loop" });
  const fromYou = card.getByRole("link", { name: "Answer round 1" });
  await expect(fromYou).toHaveAttribute("href", `/r/${owner.token}`);
  // The card still opens the loop.
  await expect(card.getByRole("link", { name: "Friday Loop" })).toHaveAttribute("href", `/g/${loop.groupId}`);

  // The overview's round card offers it too, as the one primary button.
  await page.goto(`/g/${loop.groupId}`);
  const round = page.locator('[aria-labelledby="this-round"]');
  const answer = round.getByRole("link", { name: "Answer round 1" });
  await expect(answer).toHaveAttribute("href", `/r/${owner.token}`);
  await expect(answer).toHaveClass(/btn-primary/);
  await expect(round.getByRole("button", { name: /^Nudge/ })).not.toHaveClass(/btn-primary/);
  // Nobody else's link reaches the owner's browser.
  const html = await served(page);
  expect(html).not.toContain(alice.token);
  expect(html).not.toContain(bob.token);

  // It opens the owner's own answer sheet.
  await answer.click();
  await expect(page).toHaveURL(new RegExp(`/r/${owner.token}$`));
  await waitForSheet(page);

  // Once they are in, the same button lets them edit, and steps back for the others.
  await seedReplies({
    issueId: issue.issueId,
    membershipId: owner.id,
    answers: [{ text: "What made you laugh this week?", body: "The dog." }],
  });
  await page.goto(`/g/${loop.groupId}`);
  const edit = round.getByRole("link", { name: "Edit your answers" });
  await expect(edit).toHaveAttribute("href", `/r/${owner.token}`);
  await expect(edit).not.toHaveClass(/btn-primary/);
  await expect(round.getByRole("link", { name: "Answer round 1" })).toHaveCount(0);

  await page.goto("/you");
  await expect(card.getByRole("link", { name: "Edit your answers" })).toHaveAttribute("href", `/r/${owner.token}`);
});

test("D13 · a member gets their own link, a reader none, and a paused loop none", async ({ browser }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });
  const [owner, alice] = loop.members;
  const reader = await addMember(loop, { email: "rita@friendloop.test", name: "Rita", participation: "reader" });

  // A contributing member: their own token, never the owner's.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, alice.email);
  await expect(memberPage.locator(".loop-card").getByRole("link", { name: "Answer round 1" })).toHaveAttribute("href", `/r/${alice.token}`);
  await memberPage.goto(`/g/${loop.groupId}`);
  await expect(memberPage.getByRole("link", { name: "Answer round 1" })).toHaveAttribute("href", `/r/${alice.token}`);
  expect(await served(memberPage)).not.toContain(owner.token);
  await memberContext.close();

  // A reader answers nothing, so there is nothing to offer, and no token is sent.
  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  await signIn(readerPage, reader.email);
  await expect(readerPage.locator(".loop-card", { hasText: "Friday Loop" })).toBeVisible();
  await expect(readerPage.getByRole("link", { name: /^Answer round|^Edit your answers$/ })).toHaveCount(0);
  await readerPage.goto(`/g/${loop.groupId}`);
  await expect(readerPage.getByText("Waiting on")).toBeVisible();
  await expect(readerPage.getByRole("link", { name: /^Answer round|^Edit your answers$/ })).toHaveCount(0);
  const readerHtml = await served(readerPage);
  for (const member of [...loop.members, reader]) expect(readerHtml).not.toContain(`/r/${member.token}`);
  await readerContext.close();

  // A paused loop takes no answers, so the owner is offered none either.
  await rows("update groups set paused_at = now() where id = $1", [loop.groupId]);
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner.email);
  await expect(ownerPage.locator(".loop-card", { hasText: "Paused" })).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: /^Answer round|^Edit your answers$/ })).toHaveCount(0);
  await ownerPage.goto(`/g/${loop.groupId}`);
  await expect(ownerPage.getByRole("heading", { name: "Paused" })).toBeVisible();
  await expect(ownerPage.getByRole("link", { name: /^Answer round|^Edit your answers$/ })).toHaveCount(0);
  expect(await served(ownerPage)).not.toContain(`/r/${owner.token}`);
  await ownerContext.close();
});

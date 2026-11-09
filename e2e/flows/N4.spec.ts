import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember } from "../support/seed";
import { DELIVERY_DAY, runSweep, signIn } from "../support/harness";
import { seedWorld } from "../support/identity";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("N4 · the owner names a round and the name shows on the dashboard, the web issue, the share view and the email subject", async ({ page }) => {
  const { loop, delivered, open, shareToken } = await seedWorld("n4-share-token");
  await signIn(page, "owner@friendloop.test");

  // Unnamed rounds keep their numbers.
  await page.goto(`/g/${loop.groupId}/issues`);
  await expect(page.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toBeVisible();
  await expect(page.getByText(text(copy.rounds.round, { number: 2 }), { exact: true })).toBeVisible();

  const nameRound = async (number: number, name: string) => {
    const card = page.locator(".card").filter({ has: page.getByText(text(copy.rounds.round, { number }), { exact: true }) });
    await card.getByText(copy.rounds.rename).click();
    await card.getByLabel(text(copy.rounds.nameLabel, { number })).fill(name);
    await card.getByRole("button", { name: copy.rounds.nameSave }).click();
    await expect(page.getByText(copy.rounds.nameSaved)).toBeVisible();
  };
  await nameRound(2, "Spring cleaning");
  await expect(page.getByText(text(copy.rounds.openNamed, { name: "Spring cleaning" }))).toBeVisible();
  await nameRound(1, "  Camping   weekend ");

  // "Round named." may still be up from the round before, so wait for the write itself.
  await expect.poll(() => rows<{ number: number; name: string | null }>("select number, name from issues order by number").then((found) => [...found])).toEqual([
    { number: 1, name: "Camping weekend" },
    { number: 2, name: "Spring cleaning" },
  ]);
  await expect(page.getByText("Camping weekend", { exact: true })).toBeVisible();

  // The dashboard's open round, the web issue (name as the heading, number kept as a chip), and the share view.
  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByText("Spring cleaning", { exact: true })).toBeVisible();
  await page.goto(`/i/${delivered.issueId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Camping weekend" })).toBeVisible();
  await expect(page.getByText(copyPattern(`${text(copy.issue.round, { number: 1 })}. `, { start: true }))).toBeVisible();
  await page.goto(`/s/${shareToken}`);
  await expect(page.getByRole("heading", { level: 1, name: "Camping weekend" })).toBeVisible();

  // The reply sheet greets with the name too.
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Spring cleaning" })).toBeVisible();

  // And delivery carries it into the subject, heading and body.
  await runSweep(DELIVERY_DAY);
  const [mail] = await rows<{ subject: string; html: string; text: string }>(
    "select subject, html, text from outbox where kind = 'delivery' and issue_id = $1 limit 1",
    [open.issueId],
  );
  expect(mail.subject).toMatch(/ · Spring cleaning$/);
  expect(mail.html).toContain("Spring cleaning");
  expect(mail.text).toContain("Spring cleaning");
});

test("N4 · clearing the name puts the number back, and admins are offered the control too", async ({ page, browser }) => {
  const { loop, delivered } = await seedWorld();
  await rows("update issues set name = 'Camping weekend' where id = $1", [delivered.issueId]);
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/issues`);
  const card = page.locator(".card").filter({ has: page.getByText("Camping weekend", { exact: true }) });
  // A named round offers a rename, not a first name.
  await expect(card.getByText(copy.rounds.rename)).toHaveCount(0);
  await card.getByText(copy.rounds.renameNamed, { exact: true }).click();
  await expect(card.getByLabel(text(copy.rounds.nameLabel, { number: "1" }))).toHaveValue("Camping weekend");
  await card.getByLabel(text(copy.rounds.nameLabel, { number: "1" })).fill("   ");
  await card.getByRole("button", { name: copy.rounds.nameSave }).click();
  await expect(page.getByText(copy.rounds.nameCleared)).toBeVisible();
  await expect(page.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toBeVisible();
  const [row] = await rows<{ name: string | null }>("select name from issues where id = $1", [delivered.issueId]);
  expect(row.name).toBeNull();

  await page.goto(`/i/${delivered.issueId}`);
  await expect(page.getByRole("heading", { level: 1, name: text(copy.issue.round, { number: 1 }) })).toBeVisible();

  // An admin runs the loop with the owner, so naming rounds is theirs too.
  await addMember(loop, { email: "admin@friendloop.test", access: "admin" });
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signIn(adminPage, "admin@friendloop.test");
  await adminPage.goto(`/g/${loop.groupId}/issues`);
  await expect(adminPage.getByText(text(copy.rounds.round, { number: 1 }), { exact: true })).toBeVisible();
  await expect(adminPage.getByText(copy.rounds.rename, { exact: true }).first()).toBeVisible();
  await adminContext.close();
});

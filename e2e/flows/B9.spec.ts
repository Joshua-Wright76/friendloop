import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn, uniqueEmail } from "../support/harness";
import { openInvite, openPerson } from "../support/people";
import { copy, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const invites = () =>
  rows<{ email: string; participation: string; html: string; text: string }>(
    `select m.email, m.participation, o.html, o.text from outbox o
     join memberships m on m.id = o.membership_id where o.kind = 'invite' order by m.email`,
  );

test("B9 · the owner invites someone to just read, and the invitation never asks them to answer", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  await openInvite(page);

  const choice = page.getByRole("group", { name: copy.members.inviteAs.legend });
  // Answering is the default: most people are invited to write.
  await expect(choice.getByLabel(copy.members.participation.contributor)).toBeChecked();

  await page.getByLabel(copy.members.inviteAriaLabel).fill("writer@friendloop.test");
  await page.getByRole("button", { name: copy.members.sendInvitations }).click();
  await expect(page.getByText(copy.members.invitedNotice)).toBeVisible();

  await choice.getByLabel(copy.members.participation.reader).check();
  await page.getByLabel(copy.members.inviteAriaLabel).fill("rae@friendloop.test");
  await page.getByRole("button", { name: copy.members.sendInvitations }).click();
  await expect(page.locator("#invite-people").getByText(/rae@friendloop\.test/)).toHaveCount(0);

  await expect.poll(async () => (await invites()).length).toBe(2);
  const [reader, writer] = await invites();
  expect([reader.email, reader.participation]).toEqual(["rae@friendloop.test", "reader"]);
  expect(reader.html).toContain(copy.emails.invite.readerCta);
  expect(reader.html).not.toContain(copy.emails.invite.contributorCta);
  expect([writer.email, writer.participation]).toEqual(["writer@friendloop.test", "contributor"]);
  expect(writer.html).toContain(copy.emails.invite.contributorCta);

  // The people page shows the reader as one, with nothing to chase.
  await page.reload();
  const card = await openPerson(page, "rae");
  await expect(card.getByRole("button", { name: copyPattern(copy.members.participation.ariaLabel) })).toContainText(copy.members.participation.short.reader);
});

test("B9 · the new-loop wizard offers the same choice for the people it invites", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.getByRole("link", { name: copy.you.newLoop }).click();
  await page.getByLabel(copy.newLoop.nameLabel).fill("Readers Club");
  const next = page.getByRole("button", { name: "Continue to the next setup step" });
  const progress = page.getByRole("progressbar", { name: copy.newLoop.wizard.stepAriaLabel });
  for (const step of ["2", "3", "4"]) {
    await next.click();
    await expect(progress).toHaveAttribute("aria-valuenow", step);
  }

  await page.getByLabel(copy.newLoop.wizard.readers.emailLabel).fill("nell@friendloop.test");
  await page.getByLabel(copy.newLoop.wizard.readers.emailLabel).press("Enter");
  const choice = page.getByRole("group", { name: copy.members.inviteAs.legend });
  await expect(choice.getByLabel(copy.members.participation.contributor)).toBeChecked();
  await choice.getByLabel(copy.members.participation.reader).check();
  await next.click();
  await expect(progress).toHaveAttribute("aria-valuenow", "5");
  await page.getByRole("button", { name: copy.newLoop.wizard.create }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+\?welcome=1/);

  const [nell] = await invites();
  expect([nell.email, nell.participation]).toEqual(["nell@friendloop.test", "reader"]);
  expect(nell.html).toContain(copy.emails.invite.readerCta);
});

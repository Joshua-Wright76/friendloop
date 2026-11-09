import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn, uniqueEmail } from "../support/harness";

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

  const choice = page.getByRole("group", { name: "How they take part" });
  // Answering is the default: most people are invited to write.
  await expect(choice.getByLabel("Answers and reads")).toBeChecked();

  await page.getByLabel("Invite people by email").fill("writer@friendloop.test");
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText("Invitations sent.")).toBeVisible();

  await choice.getByLabel("Reads only").check();
  await page.getByLabel("Invite people by email").fill("rae@friendloop.test");
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.locator("#invite-people").getByText(/rae@friendloop\.test/)).toHaveCount(0);

  await expect.poll(async () => (await invites()).length).toBe(2);
  const [reader, writer] = await invites();
  expect([reader.email, reader.participation]).toEqual(["rae@friendloop.test", "reader"]);
  expect(reader.html).toContain("See the loop");
  expect(reader.html).not.toContain("Answer the first round");
  expect([writer.email, writer.participation]).toEqual(["writer@friendloop.test", "contributor"]);
  expect(writer.html).toContain("Answer the first round");

  // The people page shows the reader as one, with nothing to chase.
  await page.reload();
  const card = page.locator(".member-list > li").filter({ hasText: "rae@friendloop.test" });
  await expect(card.getByRole("button", { name: /How .* takes part/ })).toContainText("Reads only");
  await expect(card.getByText("Hasn't answered anything yet")).toHaveCount(0);
});

test("B9 · the new-loop wizard offers the same choice for the people it invites", async ({ page }) => {
  await signIn(page, uniqueEmail("owner"));
  await page.getByRole("link", { name: "New loop" }).click();
  await page.getByLabel("Loop name").fill("Readers Club");
  const next = page.getByRole("button", { name: "Continue to the next setup step" });
  const progress = page.getByRole("progressbar", { name: "Loop setup progress" });
  for (const step of ["2", "3", "4"]) {
    await next.click();
    await expect(progress).toHaveAttribute("aria-valuenow", step);
  }

  await page.getByLabel("Email addresses").fill("nell@friendloop.test");
  await page.getByLabel("Email addresses").press("Enter");
  const choice = page.getByRole("group", { name: "How they take part" });
  await expect(choice.getByLabel("Answers and reads")).toBeChecked();
  await choice.getByLabel("Reads only").check();
  await next.click();
  await expect(progress).toHaveAttribute("aria-valuenow", "5");
  await page.getByRole("button", { name: "Create loop" }).click();
  await expect(page).toHaveURL(/\/g\/[0-9a-f-]+\?welcome=1/);

  const [nell] = await invites();
  expect([nell.email, nell.participation]).toEqual(["nell@friendloop.test", "reader"]);
  expect(nell.html).toContain("See the loop");
});

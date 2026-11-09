import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedDeliveredIssue, seedLoop, seedOpenIssue } from "../support/seed";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, freezeClock, waitForSheet } from "../support/harness";
import { copy, text } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("V3 · someone with only a reply link leaves the loop and takes their answers with them", async ({ page }) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;
  const bob = loop.members.find((member) => member.email === "bob@friendloop.test")!;
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [
      { email: "alice@friendloop.test", body: "Alice's old answer" },
      { email: "bob@friendloop.test", body: "Bob's old answer" },
    ],
  });
  await seedOpenIssue(loop, { openedAt: new Date(DELIVERY_DAY.getTime() + 60 * 60 * 1000) });
  await freezeClock(page, new Date(DELIVERY_DAY.getTime() + 2 * 60 * 60 * 1000));

  await page.goto(`/r/${alice.token}`);
  await waitForSheet(page);
  await page.getByRole("link", { name: copy.reply.leaveLink }).click();
  await expect(page).toHaveURL(new RegExp(`/r/${alice.token}/leave$`));
  await expect(page.getByRole("heading", { level: 1, name: text(copy.leave.title, { groupName: "Friday Loop" }) })).toBeVisible();

  // Opening the page changed nothing; the checkbox is the confirmation.
  expect(await rows("select id from memberships where id = $1", [alice.id])).toHaveLength(1);
  await page.getByLabel(text(copy.leave.confirmLabel, { groupName: "Friday Loop" })).check();
  await page.getByRole("button", { name: copy.leave.submit }).click();
  await expect(page).toHaveURL(/\/goodbye$/);

  expect(await rows("select id from memberships where id = $1", [alice.id])).toHaveLength(0);
  expect(await rows("select id from replies where body = 'Alice''s old answer'")).toHaveLength(0);

  // The link no longer opens anything, and the round reads on without her.
  await page.goto(`/r/${alice.token}`);
  await expect(page.getByRole("heading", { name: copy.reply.invalidTitle })).toBeVisible();
  await page.goto(`/i/${delivered.issueId}?m=${bob.token}`);
  await expect(page.getByText("Bob's old answer")).toBeVisible();
  await expect(page.getByText("Alice's old answer")).toHaveCount(0);
});

test("V3 · the owner cannot leave through their link", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await freezeClock(page, AFTER_FIRST_SLOT);

  await page.goto(`/r/${loop.ownerToken}/leave`);
  await expect(page.getByRole("heading", { name: text(copy.leave.ownerTitle, { groupName: "Friday Loop" }) })).toBeVisible();
  await expect(page.getByRole("button", { name: copy.leave.submit })).toHaveCount(0);
  await expect(page.getByRole("link", { name: copy.leave.ownerAction })).toHaveAttribute("href", `/g/${loop.groupId}/settings`);
});

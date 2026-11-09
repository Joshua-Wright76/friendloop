import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedDeliveredIssue, seedLoop } from "../support/seed";
import { DELIVERY_DAY, signIn } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("V2 · a signed-in person deletes their account, and every round stops showing them", async ({ page, browser }) => {
  const loop = await seedLoop();
  const wren = await addMember(loop, { email: "wren@friendloop.test", name: "Wren" });
  loop.members.push({ ...wren, participation: "contributor", access: "member" });
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: DELIVERY_DAY,
    answers: [
      { email: "wren@friendloop.test", body: "Wren went sailing" },
      { email: "alice@friendloop.test", body: "Alice baked bread" },
    ],
  });
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;

  // Alice sees Wren's answer before.
  const reader = await browser.newPage();
  await reader.goto(`/i/${issue.issueId}?m=${alice.token}`);
  await expect(reader.getByText("Wren went sailing")).toBeVisible();

  await signIn(page, "wren@friendloop.test");
  await page.getByRole("link", { name: copy.you.deleteAccount }).click();
  await expect(page).toHaveURL(/\/you\/delete$/);
  await expect(page.getByRole("heading", { level: 1, name: copy.account.metadataTitle })).toBeVisible();

  // A typo deletes nothing.
  await page.getByLabel(copy.account.confirmLabel).fill("wren@friendloop.tes");
  await page.getByRole("button", { name: copy.account.submit }).click();
  await expect(page.getByText(copy.account.confirmError)).toBeVisible();
  expect(await rows("select id from users where email = 'wren@friendloop.test'")).toHaveLength(1);

  await page.getByLabel(copy.account.confirmLabel).fill("Wren@Friendloop.test");
  await page.getByRole("button", { name: copy.account.submit }).click();
  await expect(page).toHaveURL(/\/goodbye$/);
  await expect(page.getByRole("heading", { name: copy.goodbye.title })).toBeVisible();

  expect(await rows("select id from users where email = 'wren@friendloop.test'")).toHaveLength(0);
  expect(await rows("select id from memberships where email = 'wren@friendloop.test'")).toHaveLength(0);
  expect(await rows("select id from replies where body = 'Wren went sailing'")).toHaveLength(0);

  // Signed out: the old session no longer opens /you.
  await page.goto("/you");
  await expect(page).toHaveURL(/\/signin$/);

  // The delivered round no longer shows anything from them; everyone else's stays.
  await reader.reload();
  await expect(reader.getByText("Alice baked bread")).toBeVisible();
  await expect(reader.getByText("Wren went sailing")).toHaveCount(0);
  await reader.close();
});

test("V2 · an owner with people in their loop must hand it on or delete it first", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  await page.goto("/you/delete");

  await expect(page.getByRole("heading", { name: copy.account.blockedTitle })).toBeVisible();
  await expect(page.getByText("Friday Loop")).toBeVisible();
  await expect(page.getByRole("link", { name: copy.account.handOn })).toHaveAttribute("href", `/g/${loop.groupId}/members`);
  await expect(page.getByRole("link", { name: copy.account.deleteLoop })).toHaveAttribute("href", `/g/${loop.groupId}/settings`);
  await expect(page.getByRole("button", { name: copy.account.submit })).toHaveCount(0);

  expect(await rows("select id from users where email = 'owner@friendloop.test'")).toHaveLength(1);
});

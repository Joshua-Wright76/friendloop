import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { openPart, signIn } from "../support/harness";
import { copy, text, copyPattern } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

const roles = (groupId: string) =>
  rows<{ email: string; access: string }>("select email, access from memberships where group_id = $1 order by email", [groupId]);

test("N3 · the owner hands the loop to an admin, names them in the confirmation, and can no longer hand it back", async ({ page, browser }) => {
  const loop = await seedLoop({ members: [] });
  await addMember(loop, { email: "heir@friendloop.test", access: "admin" });
  await addMember(loop, { email: "alice@friendloop.test", name: "Alice" });
  await addMember(loop, { email: "pending@friendloop.test", access: "admin", accepted: false });
  const tokensBefore = await rows("select email, reply_token from memberships where group_id = $1 order by email", [loop.groupId]);

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  // Anyone who has joined can inherit, admin or not; someone who never answered or signed in cannot.
  await expect(page.getByRole("button", { name: copyPattern(copy.members.transferAction) })).toHaveCount(2);
  await expect(page.getByRole("button", { name: text(copy.members.transferAction, { name: "heir" }) })).toBeVisible();
  await expect(page.getByRole("button", { name: text(copy.members.transferAction, { name: "Alice" }) })).toBeVisible();
  await expect(page.getByText(/Make someone an admin first/)).toHaveCount(0);
  // And the role menu no longer offers "Owner" as just another role.
  await page.locator(".card").filter({ hasText: "alice@friendloop.test" }).getByRole("button", { name: /Role for/ }).click();
  await expect(page.getByRole("option", { name: copy.common.roles.owner, exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The confirmation names the person and says what you give up; "Never mind" backs out.
  await page.getByRole("button", { name: text(copy.members.transferAction, { name: "heir" }) }).click();
  const question = page.getByRole("group", { name: copyPattern(copy.members.transferTitle, { values: { name: "heir" } }) });
  await expect(page.getByText(copyPattern(copy.members.transferTitle, { values: { name: "heir" }, start: true, end: true }))).toBeFocused();
  await expect(question).toContainText("heir becomes the owner and you become an admin. Only heir can hand it back.");
  await question.getByRole("button", { name: copy.members.transferCancel }).click();
  await expect(page.getByRole("button", { name: text(copy.members.transferAction, { name: "heir" }) })).toBeVisible();
  expect((await roles(loop.groupId)).find((row) => row.email.startsWith("owner"))!.access).toBe("owner");

  await page.getByRole("button", { name: text(copy.members.transferAction, { name: "heir" }) }).click();
  await page.getByRole("button", { name: text(copy.members.transferConfirm, { name: "heir" }) }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}/members\\?transferred=1`));
  await expect(page.getByText(/the loop has a new owner/i)).toBeVisible();

  expect(await roles(loop.groupId)).toEqual([
    { email: "alice@friendloop.test", access: "member" },
    { email: "heir@friendloop.test", access: "owner" },
    { email: "owner@friendloop.test", access: "admin" },
    { email: "pending@friendloop.test", access: "admin" },
  ]);
  // Reply tokens are untouched by a handover.
  expect(await rows("select email, reply_token from memberships where group_id = $1 order by email", [loop.groupId])).toEqual(tokensBefore);

  // The founder is still signed in, now as an admin: owner-only actions are gone and cannot be undone alone.
  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByRole("button", { name: copyPattern(copy.members.transferAction) })).toHaveCount(0);
  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));

  // The new owner holds the owner-only keys, and can hand it back.
  const heirContext = await browser.newContext();
  const heirPage = await heirContext.newPage();
  await signIn(heirPage, "heir@friendloop.test");
  await heirPage.goto(`/g/${loop.groupId}/settings`);
  await openPart(heirPage, copy.settings.groupDanger);
  await expect(heirPage.getByRole("button", { name: copy.settings.delete })).toBeVisible();
  await heirPage.goto(`/g/${loop.groupId}/members`);
  await heirPage.getByRole("button", { name: text(copy.members.transferAction, { name: "Sam" }) }).click();
  await heirPage.getByRole("button", { name: text(copy.members.transferConfirm, { name: "Sam" }) }).click();
  await expect(heirPage).toHaveURL(/transferred=1/);
  expect((await roles(loop.groupId)).find((row) => row.email.startsWith("owner"))!.access).toBe("owner");
  await heirContext.close();
});

test("N3 · a handover that is no longer valid says so and changes nothing", async ({ page }) => {
  const loop = await seedLoop();
  const heir = await addMember(loop, { email: "heir@friendloop.test", access: "admin" });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByRole("button", { name: text(copy.members.transferAction, { name: "heir" }) }).click();

  // While the question is open, the heir is removed from the loop in another tab.
  await rows("update memberships set revoked_at = now() where id = $1", [heir.id]);
  await page.getByRole("button", { name: text(copy.members.transferConfirm, { name: "heir" }) }).click();

  await expect(page).toHaveURL(/transferError=1/);
  await expect(page.getByText(/That didn't go through/)).toBeVisible();
  expect((await roles(loop.groupId)).find((row) => row.email.startsWith("owner"))!.access).toBe("owner");
});

test("N3 · the owner hands the loop straight to a member who reads, with no admin step in between", async ({ page }) => {
  const loop = await seedLoop({ members: [{ email: "rae@friendloop.test", name: "Rae", participation: "reader" }] });
  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);

  await page.getByRole("button", { name: text(copy.members.transferAction, { name: "Rae" }) }).click();
  await expect(page.getByRole("group", { name: copyPattern(copy.members.transferTitle, { values: { name: "Rae" } }) })).toContainText("Rae becomes the owner and you become an admin.");
  await page.getByRole("button", { name: text(copy.members.transferConfirm, { name: "Rae" }) }).click();
  await expect(page).toHaveURL(/transferred=1/);

  const people = await rows<{ email: string; access: string; participation: string }>(
    "select email, access, participation from memberships where group_id = $1 order by email",
    [loop.groupId],
  );
  expect(people).toEqual([
    { email: "owner@friendloop.test", access: "admin", participation: "contributor" },
    // An owner always writes, so the new owner now answers too.
    { email: "rae@friendloop.test", access: "owner", participation: "contributor" },
  ]);
});

import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G5 · transferring ownership hands over the owner-only keys", async ({ page }) => {
  const loop = await seedLoop();
  const heir = await addMember(loop, { email: "heir@friendloop.test" });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const card = page.locator(".card").filter({ hasText: "heir@friendloop.test" });
  await card.getByRole("button", { name: /Member type for/ }).click();
  await card.getByRole("option", { name: "Owner", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}/members\\?transferred=1`));
  await expect(page.getByText(/the loop has a new owner/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/the loop has a new owner/)).toBeVisible();

  const roles = await rows<{ email: string; access: string }>(
    "select email, access from memberships where group_id = $1 order by email",
    [loop.groupId],
  );
  expect(roles).toEqual([
    { email: "alice@friendloop.test", access: "member" },
    { email: "bob@friendloop.test", access: "member" },
    { email: "heir@friendloop.test", access: "owner" },
    { email: "owner@friendloop.test", access: "admin" },
  ]);

  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));

  await page.context().clearCookies();
  await signIn(page, "heir@friendloop.test");
  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page.getByRole("button", { name: "Delete forever" })).toBeVisible();
  expect(heir.id).toBeTruthy();
});

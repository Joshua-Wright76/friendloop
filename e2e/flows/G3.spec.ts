import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("G3 · an admin manages people but never reaches owner settings", async ({ page }) => {
  const loop = await seedLoop();
  const member = await addMember(loop, { email: "admin@friendloop.test", access: "member" });
  await signIn(page, "owner@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  const card = page.locator(".card").filter({ hasText: "admin@friendloop.test" });
  await card.getByRole("button", { name: "Make an admin" }).click();

  const [row] = await rows<{ access: string }>("select access from memberships where id = $1", [member.id]);
  expect(row.access).toBe("admin");

  await page.context().clearCookies();
  await signIn(page, "admin@friendloop.test");

  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByLabel("Email addresses")).toBeVisible();

  await page.goto(`/g/${loop.groupId}/questions`);
  await expect(page.getByLabel("New question")).toBeVisible();

  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));
});

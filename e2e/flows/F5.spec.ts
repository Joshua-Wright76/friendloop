import { test, expect } from "@playwright/test";
import { resetDatabase } from "../support/db";
import { addMember, seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

test("F5 · a plain member is sent away from owner routes", async ({ page }) => {
  const loop = await seedLoop();
  await addMember(loop, { email: "member@friendloop.test", access: "member" });
  await signIn(page, "member@friendloop.test");

  await page.goto(`/g/${loop.groupId}/settings`);
  await expect(page).toHaveURL(new RegExp(`/g/${loop.groupId}$`));

  await page.goto(`/g/${loop.groupId}/members`);
  await expect(page.getByLabel("Email addresses")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);

  await page.goto(`/g/${loop.groupId}`);
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send now" })).toHaveCount(0);
});

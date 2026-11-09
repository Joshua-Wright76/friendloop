import { test, expect } from "../support/test";
import { resetDatabase } from "../support/db";
import { signIn, uniqueEmail } from "../support/harness";
import { copy } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("A5 · signing out ends the session everywhere", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signIn(page, email);

  await page.getByRole("button", { name: copy.common.signOut }).click();
  await expect(page).toHaveURL(/\/signin$/);

  await page.goto("/you");
  await expect(page).toHaveURL(/\/signin$/);

  // The old cookie is gone, not just the UI.
  const cookies = await page.context().cookies();
  expect(cookies.find((cookie) => cookie.name === "fl_session")).toBeUndefined();
});

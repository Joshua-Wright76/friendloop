import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test.beforeEach(async () => {
  await resetDatabase();
});

test("S2 · the stats stay locked without the key, count the loops, and can block an account", async ({ page, context }) => {
  const locked = await page.goto("/dev/stats");
  expect(locked?.status()).toBe(404);

  await seedLoop({ name: "Saturday Club" });
  await signIn(page, "owner@friendloop.test");
  await context.clearCookies();

  await page.goto(`/dev/ui?key=${SECRET}`);
  await page.goto("/dev/stats");
  await expect(page.getByRole("heading", { name: "Stats" })).toBeVisible();
  const table = page.getByRole("region", { name: "Loops" });
  await expect(table.getByText("Saturday Club")).toBeVisible();
  await expect(table.getByText("owner@friendloop.test")).toBeVisible();

  await page.getByLabel("Email address").fill("owner@friendloop.test");
  await page.getByRole("button", { name: "Block", exact: true }).click();
  await expect(page.getByText("owner@friendloop.test is blocked.")).toBeVisible();

  const [{ blocked }] = await rows<{ blocked: boolean }>("select blocked_at is not null as blocked from users where email = 'owner@friendloop.test'");
  expect(blocked).toBe(true);

  await page.getByLabel("Email address").fill("owner@friendloop.test");
  await page.getByRole("button", { name: "Unblock" }).click();
  await expect(page.getByText("owner@friendloop.test can sign in again.")).toBeVisible();
});

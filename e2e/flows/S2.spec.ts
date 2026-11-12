import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { copy, text } from "@/lib/copy";

const SECRET = process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret";

test.beforeEach(async () => {
  await resetDatabase();
});

test("S2 · operations stay locked, usage stays anonymous, and account controls work", async ({ page, context }) => {
  const locked = await page.goto("/dev/stats");
  expect(locked?.status()).toBe(404);

  await seedLoop({ name: "Saturday Club" });
  await signIn(page, "owner@friendloop.test");
  await context.clearCookies();

  await page.goto(`/dev/ui?key=${SECRET}`);
  await page.goto("/dev/stats");
  await expect(page.getByRole("heading", { name: copy.devStats.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: copy.devStats.activityHeading })).toBeVisible();
  await expect(page.getByText(copy.devStats.privacyTitle)).toBeVisible();
  await expect(page.getByText("Saturday Club")).toHaveCount(0);
  await expect(page.getByText("owner@friendloop.test")).toHaveCount(0);

  await page.getByText(copy.devStats.blockHeading, { exact: true }).click();
  await page.getByLabel(copy.devStats.blockLabel).fill("owner@friendloop.test");
  await page.getByRole("button", { name: copy.devStats.block, exact: true }).click();
  await expect(page.getByText(text(copy.devStats.blocked, { count: 1 }))).toBeVisible();

  const [{ blocked }] = await rows<{ blocked: boolean }>("select blocked_at is not null as blocked from users where email = 'owner@friendloop.test'");
  expect(blocked).toBe(true);

  await page.getByText(copy.devStats.blockHeading, { exact: true }).click();
  await page.getByLabel(copy.devStats.blockLabel).fill("owner@friendloop.test");
  await page.getByRole("button", { name: copy.devStats.unblock }).click();
  await expect(page.getByText(copy.devStats.unblocked)).toBeVisible();
});

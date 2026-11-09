import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { LIMITS } from "../../src/lib/rate-limit-policy";

test.beforeEach(async () => {
  await resetDatabase();
});

test("B8 · past the day's invitations, the form says so and nothing else is sent", async ({ page }) => {
  const loop = await seedLoop();
  await signIn(page, "owner@friendloop.test");
  const [{ id }] = await rows<{ id: string }>("select id from users where email = 'owner@friendloop.test'");
  await rows(
    "insert into rate_limits (key, window_start, count, expires_at) values ($1, to_timestamp(floor(extract(epoch from now()) / 86400) * 86400), $2, now() + interval '2 days')",
    [`invite:user:${id}`, LIMITS.invite.max],
  );

  await page.goto(`/g/${loop.groupId}/members`);
  await page.getByLabel("Invite people by email").first().fill("one-too-many@friendloop.test");
  await page.getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText(/you've sent today's 50/)).toBeVisible();

  const sent = await rows(`select id from outbox where "to" = 'one-too-many@friendloop.test'`);
  expect(sent).toHaveLength(0);
});

import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { signIn } from "../support/harness";
import { openInvite } from "../support/people";
import { LIMITS } from "../../src/lib/rate-limit-policy";
import { copy, copyPattern } from "@/lib/copy";

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
  await openInvite(page);
  await page.getByLabel(copy.members.inviteAriaLabel).first().fill("one-too-many@friendloop.test");
  await page.getByRole("button", { name: copy.members.sendInvitations }).click();
  await expect(page.getByText(copyPattern(copy.members.inviteLimited))).toBeVisible();

  const sent = await rows(`select id from outbox where "to" = 'one-too-many@friendloop.test'`);
  expect(sent).toHaveLength(0);
});

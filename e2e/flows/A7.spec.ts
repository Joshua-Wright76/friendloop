import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { hashToken } from "../../src/lib/tokens";
import { APP, E2E_NOW, clockHeaders } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

const SESSION_COOKIE = "fl_session";
const ORIGIN = new URL(APP).origin;

async function seedSession(email: string, token: string, expiresAt: Date): Promise<void> {
  const [user] = await rows<{ id: string }>(
    `insert into users (email, name) values ($1, 'Returning') returning id`,
    [email],
  );
  await rows(
    `insert into sessions (user_id, token_hash, expires_at) values ($1, $2, $3)`,
    [user.id, hashToken(token), expiresAt.toISOString()],
  );
}

/**
 * A session that outlived its 30 days is the ordinary case for someone who
 * comes back after a summer away. The cookie is present, so nothing in the UI
 * hints at the problem — the server has to refuse it.
 */
test("A7 · an expired session is refused, not honored", async ({ context, page }) => {
  const token = "expired-session-token";
  await seedSession("returning@friendloop.test", token, new Date("2026-01-01T00:00:00Z"));

  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: ORIGIN }]);
  await page.setExtraHTTPHeaders(clockHeaders(E2E_NOW));

  await page.goto("/you");
  await expect(page).toHaveURL(/\/signin$/);

  const remaining = await rows<{ count: number }>(
    "select count(*)::int as count from sessions where token_hash = $1",
    [hashToken(token)],
  );
  expect(remaining[0].count, "the dead row is still there; it is just not accepted").toBe(1);
});

test("A7 · a session inside its window still works", async ({ context, page }) => {
  const token = "live-session-token";
  await seedSession("returning@friendloop.test", token, new Date("2026-02-01T00:00:00Z"));

  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: ORIGIN }]);
  await page.setExtraHTTPHeaders(clockHeaders(E2E_NOW));

  await page.goto("/you");
  await expect(page.getByText("returning@friendloop.test")).toBeVisible();
});

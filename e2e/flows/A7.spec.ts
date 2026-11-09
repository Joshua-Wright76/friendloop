import { test, expect } from "../support/test";
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
 * A session lasts a year from the last time it was used, so one that ran out
 * belongs to someone who stayed away all that time. The cookie is present, so nothing in the UI
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

test("A7 · using the app pushes the session a year on", async ({ context, page }) => {
  const token = "renewing-session-token";
  await seedSession("returning@friendloop.test", token, new Date(E2E_NOW.getTime() + 2 * 24 * 60 * 60 * 1000));

  await context.addCookies([{ name: SESSION_COOKIE, value: token, url: ORIGIN }]);
  await page.setExtraHTTPHeaders(clockHeaders(E2E_NOW));

  const renewed = page.waitForResponse((response) => response.url().endsWith("/api/session") && response.status() === 204);
  await page.goto("/you");
  await renewed;

  const [session] = await rows<{ expires_at: Date }>(
    "select expires_at from sessions where token_hash = $1",
    [hashToken(token)],
  );
  expect(new Date(session.expires_at).getTime()).toBe(E2E_NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
  const cookie = (await context.cookies()).find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie?.value, "same session, same cookie").toBe(token);
  // Cookie dates are whole seconds, give or take, so near enough is exact here.
  expect(Math.abs(cookie!.expires * 1000 - (E2E_NOW.getTime() + 365 * 24 * 60 * 60 * 1000)), "the cookie's date moves with it").toBeLessThan(2000);
});

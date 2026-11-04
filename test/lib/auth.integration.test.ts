import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  confirmMagicLink,
  currentUser,
  membershipFromReplyToken,
  normalizeEmail,
  peekMagicLink,
  requestMagicLink,
  signOut,
  SESSION_COOKIE,
} from "../../src/lib/auth.ts";
import { hashToken, newToken } from "../../src/lib/tokens.ts";
import { LIMITS } from "../../src/lib/rate-limit.ts";
import { latestOutbox, rows, setupDatabase } from "../support/app.ts";
import { clearRequest, cookieEntries, setRequestCookies, setRequestHeaders } from "../stubs/request.mjs";
import { E2E_NOW } from "../../e2e/support/clock.ts";

beforeEach(async () => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

/** The raw token from the newest sign-in email, as a person would use it. */
async function newestSignInToken(): Promise<string> {
  const mail = await latestOutbox("signin:");
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail.html);
  assert.ok(match, "the sign-in email carries a token");
  return decodeURIComponent(match[1]);
}


setupDatabase();

test("requesting a link records the hash, never the token", async () => {
  await requestMagicLink("  Someone@Friendloop.Test  ");

  const mail = await latestOutbox("signin:");
  assert.equal(mail.to, "someone@friendloop.test");

  const token = await newestSignInToken();
  const [link] = await rows<{ email: string; token_hash: string; expires_at: Date }>(
    "select email, token_hash, expires_at from magic_links",
  );
  assert.equal(link.email, "someone@friendloop.test");
  assert.equal(link.token_hash, hashToken(token));
  assert.ok(!link.token_hash.includes(token), "the raw token is not stored");
  assert.equal(new Date(link.expires_at).getTime(), E2E_NOW.getTime() + 15 * 60 * 1000);
});

test("using a link creates the account, the session, and a cookie", async () => {
  await requestMagicLink("new@friendloop.test");
  const token = await newestSignInToken();

  const result = await confirmMagicLink(token, { name: "  Ada  Lovelace ", timezone: "Europe/Amsterdam" });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.user.email, "new@friendloop.test");
  assert.equal(result.user.name, "Ada Lovelace");
  assert.equal(result.user.timezone, "Europe/Amsterdam");

  const cookies = cookieEntries();
  const session = cookies.find((cookie) => cookie.name === SESSION_COOKIE);
  assert.ok(session, "a session cookie was set");
  assert.equal(session.value.length, 43);

  const [stored] = await rows<{ token_hash: string; expires_at: Date }>(
    "select token_hash, expires_at from sessions",
  );
  assert.equal(stored.token_hash, hashToken(session.value));
  assert.equal(
    new Date(stored.expires_at).getTime(),
    E2E_NOW.getTime() + 30 * 24 * 60 * 60 * 1000,
  );

  const [link] = await rows<{ used_at: Date | null }>("select used_at from magic_links");
  assert.equal(new Date(link.used_at!).toISOString(), E2E_NOW.toISOString());
});

test("a link works once and only once", async () => {
  await requestMagicLink("once@friendloop.test");
  const token = await newestSignInToken();

  assert.equal((await confirmMagicLink(token)).ok, true);
  assert.deepEqual(await confirmMagicLink(token), { ok: false, reason: "used" });
});

test("a link past its 15 minutes is expired, not used", async () => {
  await requestMagicLink("late@friendloop.test");
  const token = await newestSignInToken();

  setRequestHeaders({ "x-e2e-now": new Date(E2E_NOW.getTime() + 16 * 60 * 1000).toISOString() });
  assert.deepEqual(await confirmMagicLink(token), { ok: false, reason: "expired" });
});

test("an invented token is unknown", async () => {
  assert.deepEqual(await confirmMagicLink("never-issued"), { ok: false, reason: "unknown" });
});

test("peeking reports the state without burning the link", async () => {
  await requestMagicLink("peek@friendloop.test");
  const token = await newestSignInToken();

  assert.deepEqual(await peekMagicLink(token), { state: "valid", email: "peek@friendloop.test" });
  assert.equal((await confirmMagicLink(token)).ok, true);
  assert.deepEqual(await peekMagicLink(token), { state: "used", email: "peek@friendloop.test" });
  assert.deepEqual(await peekMagicLink("nope"), { state: "unknown" });

  await requestMagicLink("peek@friendloop.test");
  const second = await newestSignInToken();
  setRequestHeaders({ "x-e2e-now": new Date(E2E_NOW.getTime() + 60 * 60 * 1000).toISOString() });
  assert.deepEqual(await peekMagicLink(second), { state: "expired", email: "peek@friendloop.test" });
});

test("signing in claims the memberships that were waiting for that address", async () => {
  const groupId = (
    await rows<{ id: string }>(
      `insert into groups (name, display_name, mode, timezone) values ('Club', 'Club', 'group', 'Europe/Amsterdam') returning id`,
    )
  )[0].id;
  const replyToken = newToken();
  await rows(
    `insert into memberships (group_id, email, name, access, participation, reply_token, invited_at)
     values ($1, 'invited@friendloop.test', null, 'member', 'contributor', $2, $3)`,
    [groupId, replyToken, E2E_NOW.toISOString()],
  );

  await requestMagicLink("invited@friendloop.test");
  const result = await confirmMagicLink(await newestSignInToken(), { name: "Grace" });
  assert.equal(result.ok, true);

  const [membership] = await rows<{
    user_id: string | null;
    name: string | null;
    accepted_at: Date | null;
  }>("select user_id, name, accepted_at from memberships where email = 'invited@friendloop.test'");
  assert.ok(membership.user_id, "the membership now belongs to the user");
  assert.equal(membership.name, "Grace", "an unnamed membership takes the name typed at sign-in");
  assert.ok(membership.accepted_at);
});

test("signing in never overwrites a name chosen elsewhere", async () => {
  const groupId = (
    await rows<{ id: string }>(
      `insert into groups (name, display_name, mode, timezone) values ('Club', 'Club', 'group', 'Europe/Amsterdam') returning id`,
    )
  )[0].id;
  await rows(
    `insert into memberships (group_id, email, name, access, participation, reply_token)
     values ($1, 'named@friendloop.test', 'Chosen Name', 'member', 'contributor', $2)`,
    [groupId, newToken()],
  );

  await requestMagicLink("named@friendloop.test");
  await confirmMagicLink(await newestSignInToken(), { name: "Other Name" });

  const [membership] = await rows<{ name: string }>(
    "select name from memberships where email = 'named@friendloop.test'",
  );
  assert.equal(membership.name, "Chosen Name");
});

test("an invalid timezone at sign-in is dropped rather than stored", async () => {
  await requestMagicLink("zone@friendloop.test");
  const result = await confirmMagicLink(await newestSignInToken(), {
    timezone: "Not/AZone",
    name: " \u0000 ",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.user.timezone, "UTC");
  assert.equal(result.user.name, null);
});

test("a returning user keeps their profile and gains a second session", async () => {
  await requestMagicLink("again@friendloop.test");
  await confirmMagicLink(await newestSignInToken(), { name: "Ada", timezone: "Asia/Tokyo" });

  await requestMagicLink("again@friendloop.test");
  await confirmMagicLink(await newestSignInToken());

  const users = await rows<{ name: string; timezone: string }>(
    "select name, timezone from users where email = 'again@friendloop.test'",
  );
  assert.equal(users.length, 1, "one account, not two");
  assert.equal(users[0].name, "Ada");
  assert.equal(users[0].timezone, "Asia/Tokyo");

  const sessions = await rows<{ count: number }>("select count(*)::int as count from sessions");
  assert.equal(sessions[0].count, 2);
});

test("currentUser reads the session cookie and ignores a dead one", async () => {
  assert.equal(await currentUser(), null, "no cookie, no user");

  await requestMagicLink("session@friendloop.test");
  const result = await confirmMagicLink(await newestSignInToken(), { name: "Sam" });
  assert.equal(result.ok, true);

  const signedIn = await currentUser();
  assert.equal(signedIn?.email, "session@friendloop.test");
  assert.equal(signedIn?.name, "Sam");

  // Same cookie, a clock past its 30 days.
  setRequestHeaders({ "x-e2e-now": new Date(E2E_NOW.getTime() + 31 * 24 * 60 * 60 * 1000).toISOString() });
  assert.equal(await currentUser(), null);

  // An invented cookie is not a session either.
  setRequestCookies({ [SESSION_COOKIE]: newToken() });
  assert.equal(await currentUser(), null);
});

test("signing out deletes the session and clears the cookie", async () => {
  await requestMagicLink("bye@friendloop.test");
  await confirmMagicLink(await newestSignInToken());
  assert.equal((await currentUser())?.email, "bye@friendloop.test");

  await signOut();

  assert.equal(cookieEntries().find((cookie) => cookie.name === SESSION_COOKIE), undefined);
  const sessions = await rows<{ count: number }>("select count(*)::int as count from sessions");
  assert.equal(sessions[0].count, 0);

  // Signing out without a session is a no-op, not a crash.
  await signOut();
});

test("a reply token resolves to its membership until it is revoked", async () => {
  const groupId = (
    await rows<{ id: string }>(
      `insert into groups (name, display_name, mode, timezone) values ('Club', 'Club', 'group', 'Europe/Amsterdam') returning id`,
    )
  )[0].id;
  const token = newToken();
  await rows(
    `insert into memberships (group_id, email, access, participation, reply_token)
     values ($1, 'member@friendloop.test', 'member', 'contributor', $2)`,
    [groupId, token],
  );

  const found = await membershipFromReplyToken(token);
  assert.equal(found?.membership.email, "member@friendloop.test");
  assert.equal(found?.email, "member@friendloop.test");

  await rows("update memberships set revoked_at = $1 where reply_token = $2", [E2E_NOW.toISOString(), token]);
  assert.equal(await membershipFromReplyToken(token), null);
  assert.equal(await membershipFromReplyToken("never-issued"), null);
});

test("email normalization is just trim and lowercase", () => {
  assert.equal(normalizeEmail("  Someone@Example.COM "), "someone@example.com");
});

const signInCount = async () =>
  (await rows<{ count: number }>("select count(*)::int as count from outbox where kind = 'signin'"))[0].count;
const linkCount = async () =>
  (await rows<{ count: number }>("select count(*)::int as count from magic_links"))[0].count;

test("an address gets five links per window; the sixth is quiet and sends nothing", async () => {
  const outcomes = [];
  for (let i = 0; i < LIMITS.signInEmail.max + 1; i++) {
    outcomes.push(await requestMagicLink(i % 2 ? "Target@Friendloop.Test" : "target@friendloop.test", { ip: `198.51.100.${i}` }));
  }
  assert.deepEqual(outcomes, ["sent", "sent", "sent", "sent", "sent", "quiet"]);
  assert.equal(await signInCount(), LIMITS.signInEmail.max);
  assert.equal(await linkCount(), LIMITS.signInEmail.max);

  // Someone else is unaffected.
  assert.equal(await requestMagicLink("other@friendloop.test", { ip: "198.51.100.99" }), "sent");
});

test("an address can ask again once its window closes", async () => {
  for (let i = 0; i < LIMITS.signInEmail.max; i++) await requestMagicLink("target@friendloop.test", { ip: "198.51.100.1" });
  assert.equal(await requestMagicLink("target@friendloop.test", { ip: "198.51.100.1" }), "quiet");

  setRequestHeaders({ "x-e2e-now": new Date(E2E_NOW.getTime() + LIMITS.signInEmail.windowMs).toISOString() });
  assert.equal(await requestMagicLink("target@friendloop.test", { ip: "198.51.100.1" }), "sent");
  assert.equal(await signInCount(), LIMITS.signInEmail.max + 1);
});

test("one network gets twenty requests an hour, whatever the addresses; then busy, and nothing is sent", async () => {
  for (let i = 0; i < LIMITS.signInIp.max; i++) {
    assert.equal(await requestMagicLink(`person${i}@friendloop.test`, { ip: "203.0.113.7" }), "sent");
  }
  assert.equal(await requestMagicLink("fresh@friendloop.test", { ip: "203.0.113.7" }), "busy");
  assert.equal(await signInCount(), LIMITS.signInIp.max);

  // A busy network does not use up the address's own allowance.
  assert.equal(await requestMagicLink("fresh@friendloop.test", { ip: "203.0.113.8" }), "sent");
  const [bucket] = await rows<{ count: number }>("select count from rate_limits where key = 'signin:email:fresh@friendloop.test'");
  assert.equal(bucket.count, 1);
});

test("a request with no known address shares the unknown bucket", async () => {
  await requestMagicLink("someone@friendloop.test");
  const keys = await rows<{ key: string }>("select key from rate_limits order by key");
  assert.deepEqual(keys.map((r) => r.key), ["signin:email:someone@friendloop.test", "signin:ip:unknown"]);
});

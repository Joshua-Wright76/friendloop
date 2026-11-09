import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanSignInCode,
  confirmMagicLink,
  confirmSignInCode,
  currentUser,
  LINK_HOURS,
  membershipFromReplyToken,
  normalizeEmail,
  peekMagicLink,
  renewSession,
  requestMagicLink,
  signOut,
  SESSION_COOKIE,
  SESSION_DAYS,
} from "../../src/lib/auth.ts";
import { hashToken, newToken } from "../../src/lib/tokens.ts";
import { LIMITS } from "../../src/lib/rate-limit.ts";
import { latestOutbox, rows, setupDatabase } from "../support/app.ts";
import { clearRequest, cookieEntries, setRequestCookies, setRequestHeaders } from "../stubs/request.mjs";
import { E2E_NOW } from "../../e2e/support/clock.ts";
import { copy, copyPattern } from "@/lib/copy";

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

/** The code from the newest sign-in email, as a person would read it. */
async function newestSignInCode(): Promise<string> {
  const mail = await latestOutbox("signin:");
  const match = copyPattern(copy.emails.signIn.text, { values: { code: /(\d{6})/ } }).exec(mail.text);
  assert.ok(match, "the sign-in email carries a code");
  return match[1];
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number) => setRequestHeaders({ "x-e2e-now": new Date(E2E_NOW.getTime() + ms).toISOString() });

setupDatabase();

test("requesting a link records the hash, never the token", async () => {
  await requestMagicLink("  Someone@Friendloop.Test  ");

  const mail = await latestOutbox("signin:");
  assert.equal(mail.to, "someone@friendloop.test");

  const token = await newestSignInToken();
  const code = await newestSignInCode();
  const [link] = await rows<{ email: string; token_hash: string; code_hash: string; expires_at: Date }>(
    "select email, token_hash, code_hash, expires_at from magic_links",
  );
  assert.equal(link.email, "someone@friendloop.test");
  assert.equal(link.token_hash, hashToken(token));
  assert.ok(!link.token_hash.includes(token), "the raw token is not stored");
  assert.ok(link.code_hash && !link.code_hash.includes(code), "the code is stored hashed");
  assert.equal(new Date(link.expires_at).getTime(), E2E_NOW.getTime() + 100 * HOUR);
  assert.equal(LINK_HOURS, 100);
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
    E2E_NOW.getTime() + 365 * DAY,
  );

  const [link] = await rows<{ used_at: Date | null }>("select used_at from magic_links");
  assert.equal(new Date(link.used_at!).toISOString(), E2E_NOW.toISOString());
});

test("a link works again and again, on any device, until its 100 hours are up", async () => {
  await requestMagicLink("again-and-again@friendloop.test");
  const token = await newestSignInToken();

  assert.equal((await confirmMagicLink(token)).ok, true);
  at(3 * DAY);
  assert.equal((await confirmMagicLink(token)).ok, true, "a second device, three days on");

  // The first use is kept as a record; later uses don't move it.
  const [link] = await rows<{ used_at: Date }>("select used_at from magic_links");
  assert.equal(new Date(link.used_at).toISOString(), E2E_NOW.toISOString());
  const sessions = await rows<{ count: number }>("select count(*)::int as count from sessions");
  assert.equal(sessions[0].count, 2);

  at(100 * HOUR);
  assert.deepEqual(await confirmMagicLink(token), { ok: false, reason: "expired" });
});

test("a link for a blocked address signs nobody in", async () => {
  await requestMagicLink("blocked-later@friendloop.test");
  const token = await newestSignInToken();
  await rows("insert into users (email, blocked_at) values ('blocked-later@friendloop.test', now())");
  assert.deepEqual(await confirmMagicLink(token), { ok: false, reason: "unknown" });
});

test("an invented token is unknown", async () => {
  assert.deepEqual(await confirmMagicLink("never-issued"), { ok: false, reason: "unknown" });
});

test("peeking reports the state without burning the link", async () => {
  await requestMagicLink("peek@friendloop.test");
  const token = await newestSignInToken();

  assert.deepEqual(await peekMagicLink(token), { state: "valid", email: "peek@friendloop.test" });
  assert.equal((await confirmMagicLink(token)).ok, true);
  assert.deepEqual(await peekMagicLink(token), { state: "valid", email: "peek@friendloop.test" }, "using it doesn't end it");
  assert.deepEqual(await peekMagicLink("nope"), { state: "unknown" });

  at(101 * HOUR);
  assert.deepEqual(await peekMagicLink(token), { state: "expired", email: "peek@friendloop.test" });
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

  // Same cookie, a clock past its year.
  at(366 * DAY);
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

// ── codes ────────────────────────────────────────────────────

test("a code is six digits, and spaces or dashes typed around it don't matter", () => {
  assert.equal(cleanSignInCode(" 042 917 "), "042917");
  assert.equal(cleanSignInCode("042-917"), "042917");
  assert.equal(cleanSignInCode("42917"), null);
  assert.equal(cleanSignInCode("04291a"), null);
});

test("the emailed code signs a returning person straight in, for as long as the link lasts", async () => {
  await requestMagicLink("coder@friendloop.test");
  await confirmMagicLink(await newestSignInToken(), { name: "Cody" });
  setRequestCookies({});

  await requestMagicLink("coder@friendloop.test");
  const code = await newestSignInCode();
  at(99 * HOUR);
  const result = await confirmSignInCode(" Coder@Friendloop.Test ", `${code.slice(0, 3)} ${code.slice(3)}`, {
    ip: "192.0.2.1",
    profile: { timezone: "Asia/Tokyo" },
  });
  assert.equal(result.ok, true);
  if (result.ok !== true) return;
  assert.equal(result.user.name, "Cody");
  assert.equal(result.user.timezone, "Asia/Tokyo");
  assert.ok(cookieEntries().some((cookie) => cookie.name === SESSION_COOKIE));
  // Again, from another device.
  assert.equal((await confirmSignInCode("coder@friendloop.test", code, { ip: "192.0.2.1" })).ok, true);

  at(100 * HOUR);
  assert.deepEqual(await confirmSignInCode("coder@friendloop.test", code, { ip: "192.0.2.1" }), { ok: false, reason: "wrong" });
});

test("someone new is handed a short confirm link, so they can give their name there", async () => {
  await requestMagicLink("newcomer@friendloop.test");
  const result = await confirmSignInCode("newcomer@friendloop.test", await newestSignInCode(), { ip: "192.0.2.2" });
  assert.equal(result.ok, "name");
  if (result.ok !== "name") return;
  assert.equal(cookieEntries().find((cookie) => cookie.name === SESSION_COOKIE), undefined, "not signed in yet");
  assert.deepEqual(await peekMagicLink(result.token), { state: "valid", email: "newcomer@friendloop.test" });

  const [handed] = await rows<{ expires_at: Date; code_hash: string | null }>(
    "select expires_at, code_hash from magic_links where token_hash = $1", [hashToken(result.token)]);
  assert.equal(new Date(handed.expires_at).getTime(), E2E_NOW.getTime() + 15 * 60 * 1000);
  assert.equal(handed.code_hash, null, "it has no code of its own");

  const signedIn = await confirmMagicLink(result.token, { name: "Nia" });
  assert.equal(signedIn.ok && signedIn.user.name, "Nia");
});

test("a code only works for the address it was sent to", async () => {
  await requestMagicLink("mine@friendloop.test");
  const code = await newestSignInCode();
  await requestMagicLink("theirs@friendloop.test");
  assert.deepEqual(await confirmSignInCode("theirs@friendloop.test", code, { ip: "192.0.2.3" }), { ok: false, reason: "wrong" });
});

test("only the newest email's code works, so asking for more links adds nothing to guess at", async () => {
  await requestMagicLink("twice@friendloop.test");
  const older = await newestSignInCode();
  const olderToken = await newestSignInToken();
  at(60 * 1000);
  await requestMagicLink("twice@friendloop.test");
  const newer = await newestSignInCode();

  if (older !== newer) {
    assert.deepEqual(await confirmSignInCode("twice@friendloop.test", older, { ip: "192.0.2.10" }), { ok: false, reason: "wrong" });
  }
  assert.equal((await confirmSignInCode("twice@friendloop.test", newer, { ip: "192.0.2.10" })).ok, "name");
  assert.equal((await confirmMagicLink(olderToken)).ok, true, "the older link itself still works");
});

test("an address takes ten codes a day, parallel or not, then even the right one waits; the link still works", async () => {
  await requestMagicLink("guessed@friendloop.test");
  const token = await newestSignInToken();
  const code = await newestSignInCode();
  const wrong = code === "000000" ? "000001" : "000000";

  // Fired at once, from many networks: the count is taken before anything is checked.
  const guesses = await Promise.all(
    Array.from({ length: 15 }, (_, i) => confirmSignInCode("guessed@friendloop.test", wrong, { ip: `192.0.2.${100 + i}` })),
  );
  assert.equal(guesses.filter((g) => !g.ok && g.reason === "wrong").length, LIMITS.signInCodeEmail.max);
  assert.equal(guesses.filter((g) => !g.ok && g.reason === "locked").length, 15 - LIMITS.signInCodeEmail.max);
  assert.deepEqual(await confirmSignInCode("guessed@friendloop.test", code, { ip: "192.0.2.20" }), { ok: false, reason: "locked" });
  assert.equal((await confirmMagicLink(token)).ok, true);

  // A fresh link doesn't reset the count.
  await requestMagicLink("guessed@friendloop.test");
  assert.deepEqual(
    await confirmSignInCode("guessed@friendloop.test", await newestSignInCode(), { ip: "192.0.2.21" }),
    { ok: false, reason: "locked" },
  );

  // An address nobody has is locked the same way, so the lock says nothing about accounts.
  for (let i = 0; i < LIMITS.signInCodeEmail.max; i++) await confirmSignInCode("nobody-here@friendloop.test", wrong, { ip: "192.0.2.22" });
  assert.deepEqual(await confirmSignInCode("nobody-here@friendloop.test", wrong, { ip: "192.0.2.23" }), { ok: false, reason: "locked" });

  // Tomorrow, the right code works.
  at(LIMITS.signInCodeEmail.windowMs);
  const fresh = await newestSignInCode();
  assert.equal((await confirmSignInCode("guessed@friendloop.test", fresh, { ip: "192.0.2.24" })).ok, "name");
});

test("codes are keyed with the server secret, so a leaked table alone can't recover them", async () => {
  const original = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "secret-one";
    await requestMagicLink("keyed@friendloop.test");
    const code = await newestSignInCode();
    process.env.CRON_SECRET = "secret-two";
    assert.deepEqual(await confirmSignInCode("keyed@friendloop.test", code, { ip: "192.0.2.40" }), { ok: false, reason: "wrong" });
    process.env.CRON_SECRET = "secret-one";
    assert.equal((await confirmSignInCode("keyed@friendloop.test", code, { ip: "192.0.2.40" })).ok, "name");
  } finally {
    if (original === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = original;
  }
});

test("a malformed code isn't a guess and costs the address nothing", async () => {
  await requestMagicLink("typo@friendloop.test");
  assert.deepEqual(await confirmSignInCode("typo@friendloop.test", "12", { ip: "192.0.2.25" }), { ok: false, reason: "wrong" });
  const buckets = await rows<{ key: string }>("select key from rate_limits where key like 'signin:code-email:%'");
  assert.equal(buckets.length, 0);
});

test("a blocked address's code signs nobody in", async () => {
  await requestMagicLink("blocked-code@friendloop.test");
  const code = await newestSignInCode();
  await rows("insert into users (email, name, blocked_at) values ('blocked-code@friendloop.test', 'B', now())");
  assert.deepEqual(await confirmSignInCode("blocked-code@friendloop.test", code, { ip: "192.0.2.30" }), { ok: false, reason: "wrong" });
});

test("one network gets thirty codes an hour, right or wrong; then busy", async () => {
  for (let i = 0; i < LIMITS.signInCode.max; i++) await confirmSignInCode("nobody@friendloop.test", "123456", { ip: "203.0.113.50" });
  await requestMagicLink("late-coder@friendloop.test", { ip: "203.0.113.51" });
  const code = await newestSignInCode();
  assert.deepEqual(await confirmSignInCode("late-coder@friendloop.test", code, { ip: "203.0.113.50" }), { ok: false, reason: "busy" });
  assert.equal((await confirmSignInCode("late-coder@friendloop.test", code)).ok, "name", "another network is fine");
});

// ── staying signed in ────────────────────────────────────────

test("a session in use is renewed for a year from today, at most daily, and a dead one never comes back", async () => {
  assert.equal(SESSION_DAYS, 365);
  assert.equal(await renewSession(), false, "no cookie, nothing to renew");

  await requestMagicLink("stayer@friendloop.test");
  await confirmMagicLink(await newestSignInToken());
  const expiry = async () => new Date((await rows<{ expires_at: Date }>("select expires_at from sessions"))[0].expires_at).getTime();

  assert.equal(await renewSession(), false, "made today, nothing to do");
  at(12 * HOUR);
  assert.equal(await renewSession(), false, "still within a day");

  at(300 * DAY);
  assert.equal(await renewSession(), true);
  assert.equal(await expiry(), E2E_NOW.getTime() + 300 * DAY + 365 * DAY);
  const cookie = cookieEntries().find((entry) => entry.name === SESSION_COOKIE);
  assert.ok(cookie, "the cookie is set again with the new date");

  // Long past where the first year would have ended, it still works.
  at(600 * DAY);
  assert.equal((await currentUser())?.email, "stayer@friendloop.test");

  at(300 * DAY + 366 * DAY);
  assert.equal(await renewSession(), false);
  assert.equal(await currentUser(), null);
});

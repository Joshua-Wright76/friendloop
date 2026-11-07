import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  confirmEmailChange,
  peekEmailChange,
  requestEmailChange,
  setAccountBlocked,
} from "../../src/lib/account.ts";
import { confirmMagicLink, requestMagicLink } from "../../src/lib/auth.ts";
import { dailySendBudget, flushOutbox, sendEmail, TRANSPORT_HEADER } from "../../src/lib/email/send.ts";
import { eraseAccount } from "../../src/lib/erasure.ts";
import { submitFeedback } from "../../src/lib/feedback.ts";
import { changeMemberEmail, inviteMembers, ownedLoopCount } from "../../src/lib/manage.ts";
import { LIMITS, MAX_MEMBERS_PER_LOOP, limitKey } from "../../src/lib/rate-limit-policy.ts";
import { consume } from "../../src/lib/rate-limit.ts";
import { uploadRefused } from "../../src/lib/upload-limit.ts";
import { readStats } from "../../src/lib/stats.ts";
import { hashToken } from "../../src/lib/tokens.ts";
import { linkFrom, rows, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import {
  FAKE_MAIL_URL,
  failNextSends,
  providerLog,
  startFakeResend,
  stopFakeResend,
} from "../../e2e/support/fake-resend.ts";

process.env.RESEND_BASE_URL = FAKE_MAIL_URL;
process.env.RESEND_API_KEY = "re_test_key";

let stub: Server | null = null;
before(async () => {
  stub = await startFakeResend();
});
after(async () => {
  await stopFakeResend(stub);
});

setupDatabase();

const ACTOR = "00000000-0000-4000-8000-000000000001";

function clockOnly() {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
}
function realProvider() {
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString(), [TRANSPORT_HEADER]: "resend" });
}

beforeEach(async () => {
  await failNextSends(0);
  setEnv("EMAIL_DAILY_BUDGET", undefined);
  setEnv("FEEDBACK_NOTIFY_EMAIL", undefined);
  clockOnly();
});

const mail = (to: string, dedupeKey: string, extra: Partial<Parameters<typeof sendEmail>[0]> = {}) =>
  sendEmail({ to, subject: "Hi", html: "<p>hi</p>", text: "hi", kind: "prompt", dedupeKey, ...extra });

async function ownerUserId(email = "owner@friendloop.test"): Promise<string> {
  await requestMagicLink(email);
  const [row] = await rows<{ html: string }>(
    `select html from outbox where kind = 'signin' and "to" = $1 order by created_at desc limit 1`,
    [email],
  );
  const token = new URL(linkFrom(row.html, "/signin/confirm"), "http://x").searchParams.get("token")!;
  const confirmed = await confirmMagicLink(token);
  assert.equal(confirmed.ok, true);
  return confirmed.ok ? confirmed.user.id : "";
}

test("a loop email replies to the owner, and a retry keeps that and the loop's name", async () => {
  const loop = await seedLoop();
  realProvider();
  await failNextSends(1);
  await mail("bob@friendloop.test", "prompt:retry", { groupId: loop.groupId, fromName: "Saturday Club" });

  const [failed] = await rows<{ status: string; reply_to: string; from_name: string }>(
    "select status, reply_to, from_name from outbox where dedupe_key = 'prompt:retry'",
  );
  assert.equal(failed.status, "failed");
  assert.equal(failed.reply_to, "owner@friendloop.test");
  assert.equal(failed.from_name, "Saturday Club");

  await flushOutbox();
  const sent = (await providerLog()).at(-1)!;
  assert.match(String(sent.from), /^Saturday Club </);
  assert.deepEqual([sent.reply_to].flat(), ["owner@friendloop.test"]);
});

test("loop mail stops short of the daily budget, sign-in links still go, and the sweep catches up", async () => {
  setEnv("EMAIL_DAILY_BUDGET", "22");
  assert.equal(dailySendBudget(), 22);
  realProvider();

  await mail("a@friendloop.test", "prompt:a");
  await mail("b@friendloop.test", "prompt:b");
  await mail("c@friendloop.test", "prompt:c");

  const status = async (key: string) =>
    (await rows<{ status: string; attempts: number }>("select status, attempts from outbox where dedupe_key = $1", [key]))[0];
  assert.equal((await status("prompt:a")).status, "sent");
  assert.equal((await status("prompt:b")).status, "sent");
  assert.deepEqual(await status("prompt:c"), { status: "pending", attempts: 0 });

  await mail("d@friendloop.test", "signin:d", { kind: "signin" });
  assert.equal((await status("signin:d")).status, "sent");

  await flushOutbox();
  assert.equal((await status("prompt:c")).status, "pending");

  await rows("update outbox set sent_at = now() - interval '25 hours' where status = 'sent'");
  await flushOutbox();
  assert.equal((await status("prompt:c")).status, "sent");
});

test("a person's invitations stop at the daily limit, and the rest are reported rather than sent", async () => {
  const loop = await seedLoop();
  const emails = Array.from({ length: 5 }, (_, i) => `p${i}@friendloop.test`);
  // Only two left today. The counter is set directly, because the member cap is lower than this limit's headroom.
  await rows(`insert into rate_limits (key, window_start, count, expires_at) values ($1, to_timestamp(floor(extract(epoch from $2::timestamptz) / 86400) * 86400), $3, now() + interval '2 days')`, [
    `invite:user:${ACTOR}`,
    AFTER_FIRST_SLOT.toISOString(),
    LIMITS.invite.max - 2,
  ]);
  const result = await inviteMembers({ groupId: loop.groupId, emails, participation: "contributor", actorName: "Sam", actorUserId: ACTOR, at: AFTER_FIRST_SLOT });
  assert.deepEqual(result, { invited: 2, skipped: 0, limited: 3 });
  const [{ count }] = await rows<{ count: number }>("select count(*)::int as count from memberships where email like 'p%'");
  assert.equal(count, 2);
});

test("a loop stops at its member cap", async () => {
  const loop = await seedLoop();
  const [{ current }] = await rows<{ current: number }>("select count(*)::int as current from memberships where group_id = $1", [loop.groupId]);
  const emails = Array.from({ length: MAX_MEMBERS_PER_LOOP - current + 2 }, (_, i) => `m${i}@friendloop.test`);
  const result = await inviteMembers({ groupId: loop.groupId, emails, participation: "contributor", actorName: "Sam", actorUserId: ACTOR, at: AFTER_FIRST_SLOT });
  assert.equal(result.invited, MAX_MEMBERS_PER_LOOP - current);
  assert.equal(result.limited, 2);
});

test("fixing a typo keeps the person's membership, replaces their link, and invites the new address", async () => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const at = AFTER_FIRST_SLOT;
  const fix = (newEmail: string, membershipId = bob.id) =>
    changeMemberEmail({ groupId: loop.groupId, membershipId, newEmail, actorName: "Sam", actorUserId: ACTOR, at });

  assert.equal(await fix("not-an-address"), "invalid");
  const alice = loop.members.find((member) => member.email !== bob.email && !member.email.startsWith("owner"))!;
  assert.equal(await fix(alice.email), "taken");

  assert.equal(await fix("Robert@Friendloop.test"), "changed");
  const [row] = await rows<{ id: string; email: string; reply_token: string }>(
    "select id, email, reply_token from memberships where id = $1",
    [bob.id],
  );
  assert.equal(row.id, bob.id);
  assert.equal(row.email, "robert@friendloop.test");
  assert.notEqual(row.reply_token, bob.token);
  const [{ count }] = await rows<{ count: number }>(`select count(*)::int as count from outbox where kind = 'invite' and "to" = 'robert@friendloop.test'`);
  assert.equal(count, 1);
});

test("someone who has signed in can't have their address changed for them", async () => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await ownerUserId(bob.email);
  const result = await changeMemberEmail({ groupId: loop.groupId, membershipId: bob.id, newEmail: "elsewhere@friendloop.test", actorName: "Sam", actorUserId: ACTOR, at: AFTER_FIRST_SLOT });
  assert.equal(result, "refused");
});

async function changeLink(to: string): Promise<string> {
  const [row] = await rows<{ html: string }>(
    `select html from outbox where kind = 'email_change' and "to" = $1 order by created_at desc limit 1`,
    [to],
  );
  return new URL(linkFrom(row.html, "/you/email/confirm"), "http://x").searchParams.get("token")!;
}

test("moving an account takes effect only from the new inbox, moves every loop, and tells the old address", async () => {
  await seedLoop();
  const id = await ownerUserId();
  const user = { id, email: "owner@friendloop.test" };

  assert.equal(await requestEmailChange(user, "nope"), "invalid");
  assert.equal(await requestEmailChange(user, "OWNER@friendloop.test"), "same");
  assert.equal(await requestEmailChange(user, "New@Friendloop.test"), "sent");

  const [before] = await rows<{ email: string }>("select email from users where id = $1", [id]);
  assert.equal(before.email, "owner@friendloop.test");

  const token = await changeLink("new@friendloop.test");
  assert.deepEqual(await peekEmailChange(token), { state: "valid", newEmail: "new@friendloop.test" });
  assert.equal(await confirmEmailChange(token), "changed");
  assert.equal(await confirmEmailChange(token), "used");

  const [after] = await rows<{ email: string }>("select email from users where id = $1", [id]);
  assert.equal(after.email, "new@friendloop.test");
  const [member] = await rows<{ email: string }>("select email from memberships where user_id = $1", [id]);
  assert.equal(member.email, "new@friendloop.test");

  const [notice] = await rows<{ count: number }>(`select count(*)::int as count from outbox where "to" = 'owner@friendloop.test' and dedupe_key like 'email-changed:%'`);
  assert.equal(notice.count, 1);
});

test("an address already in use, or a stale link, changes nothing", async () => {
  await seedLoop();
  const id = await ownerUserId();
  const user = { id, email: "owner@friendloop.test" };
  await ownerUserId("taken@friendloop.test");

  // Asking says the same thing either way, so it can't reveal who has an account.
  assert.equal(await requestEmailChange(user, "taken@friendloop.test"), "sent");
  assert.equal(await confirmEmailChange(await changeLink("taken@friendloop.test")), "taken");

  // Someone in one of their loops already uses it.
  assert.equal(await requestEmailChange(user, "bob@friendloop.test"), "sent");
  assert.equal(await confirmEmailChange(await changeLink("bob@friendloop.test")), "taken");

  assert.equal(await requestEmailChange(user, "late@friendloop.test"), "sent");
  const late = await changeLink("late@friendloop.test");
  await rows("update email_changes set expires_at = $1 where token_hash = $2", [new Date(AFTER_FIRST_SLOT.getTime() - 1000).toISOString(), hashToken(late)]);
  assert.equal(await confirmEmailChange(late), "expired");
  assert.equal(await confirmEmailChange("made-up"), "unknown");

  const [row] = await rows<{ email: string }>("select email from users where id = $1", [id]);
  assert.equal(row.email, "owner@friendloop.test");
});

test("deleting an account also removes the notice sent to the address it moved away from", async () => {
  const id = await ownerUserId("mover@friendloop.test");
  await requestEmailChange({ id, email: "mover@friendloop.test" }, "moved@friendloop.test");
  await confirmEmailChange(await changeLink("moved@friendloop.test"));

  const result = await eraseAccount(id);
  assert.equal(result.ok, true);
  const left = await rows(`select id from outbox where "to" in ('mover@friendloop.test', 'moved@friendloop.test')`);
  assert.equal(left.length, 0);
});

test("a blocked account can't sign in, its loops pause and their unsent mail stops; unblocking restores sign-in", async () => {
  const loop = await seedLoop();
  const id = await ownerUserId();
  await mail("bob@friendloop.test", "prompt:held", { groupId: loop.groupId });
  await rows("update outbox set status = 'pending' where dedupe_key = 'prompt:held'");
  await requestMagicLink("owner@friendloop.test");
  const [link] = await rows<{ html: string }>(`select html from outbox where kind = 'signin' order by created_at desc limit 1`);
  const stale = new URL(linkFrom(link.html, "/signin/confirm"), "http://x").searchParams.get("token")!;

  assert.deepEqual(await setAccountBlocked("Nobody@friendloop.test", true, AFTER_FIRST_SLOT), { found: false, paused: 0 });
  assert.deepEqual(await setAccountBlocked("OWNER@friendloop.test", true, AFTER_FIRST_SLOT), { found: true, paused: 1 });

  const [{ count: sessions }] = await rows<{ count: number }>("select count(*)::int as count from sessions where user_id = $1", [id]);
  assert.equal(sessions, 0);
  const [{ paused_at }] = await rows<{ paused_at: Date | null }>("select paused_at from groups where id = $1", [loop.groupId]);
  assert.notEqual(paused_at, null);
  const [held] = await rows<{ status: string }>("select status from outbox where dedupe_key = 'prompt:held'");
  assert.equal(held.status, "suppressed");

  // A link from before the block doesn't work, and asking for another sends nothing.
  assert.equal((await confirmMagicLink(stale)).ok, false);
  const signins = async () => (await rows<{ count: number }>(`select count(*)::int as count from outbox where kind = 'signin'`))[0].count;
  const before = await signins();
  assert.equal(await requestMagicLink("owner@friendloop.test"), "quiet");
  assert.equal(await signins(), before);

  await setAccountBlocked("owner@friendloop.test", false, AFTER_FIRST_SLOT);
  assert.equal(await requestMagicLink("owner@friendloop.test"), "sent");
});

test("a feedback note is emailed when an address is set, without more than a few an hour", async () => {
  const note = { message: "The save button does nothing", path: "/g/abc", userAgent: "T", viewport: "1×1", ip: "198.51.100.1" };
  const sent = async () => (await rows<{ count: number }>(`select count(*)::int as count from outbox where kind = 'feedback'`))[0].count;

  await submitFeedback(note, null);
  assert.equal(await sent(), 0);

  setEnv("FEEDBACK_NOTIFY_EMAIL", "me@friendloop.test");
  await submitFeedback(note, null);
  assert.equal(await sent(), 1);
  const [row] = await rows<{ to: string; text: string }>(`select "to", text from outbox where kind = 'feedback'`);
  assert.equal(row.to, "me@friendloop.test");
  assert.match(row.text, /The save button does nothing/);

  for (let i = 0; i < LIMITS.feedbackNotify.max + 2; i++) await submitFeedback({ ...note, ip: `198.51.100.${i + 2}` }, null);
  assert.equal(await sent(), LIMITS.feedbackNotify.max);
  const [{ count: stored }] = await rows<{ count: number }>("select count(*)::int as count from feedback");
  assert.equal(stored, LIMITS.feedbackNotify.max + 4);
});

test("the stats count real loops, leave the demo out, and list who is blocked", async () => {
  const loop = await seedLoop();
  await ownerUserId();
  await rows("insert into groups (name, timezone, is_synthetic) values ('Demo', 'UTC', true)");
  await setAccountBlocked("owner@friendloop.test", true, AFTER_FIRST_SLOT);

  const stats = await readStats();
  assert.deepEqual(stats.loops.map((row) => row.id), [loop.groupId]);
  assert.equal(stats.loops[0].paused, true);
  assert.equal(stats.loops[0].owner, "owner@friendloop.test");
  assert.equal(stats.activeLoops, 0);
  assert.equal(stats.pausedLoops, 1);
  assert.deepEqual(stats.blocked, ["owner@friendloop.test"]);
  assert.equal(stats.budget, dailySendBudget());
});

test("the owned-loop count follows ownership only", async () => {
  await seedLoop();
  const id = await ownerUserId();
  assert.equal(await ownedLoopCount(id), 1);
  const bobId = await ownerUserId("bob@friendloop.test");
  assert.equal(await ownedLoopCount(bobId), 0);
});

test("one link or loop can only upload so many files an hour, and another is unaffected", async () => {
  for (let i = 0; i < LIMITS.upload.max; i++) assert.equal(await uploadRefused("token-a", "too many"), null);
  const refused = await uploadRefused("token-a", "too many");
  assert.equal(refused?.status, 429);
  assert.deepEqual(await refused?.json(), { error: "too many" });
  assert.equal(await uploadRefused("token-b", "too many"), null);
});

test("a loop can only be nudged by hand a few times a day", async () => {
  const key = limitKey.nudge("loop-a");
  for (let i = 0; i < LIMITS.nudge.max; i++) assert.equal((await consume(key, LIMITS.nudge, AFTER_FIRST_SLOT)).allowed, true);
  assert.equal((await consume(key, LIMITS.nudge, AFTER_FIRST_SLOT)).allowed, false);
});

test("a note is still kept when emailing it fails", async () => {
  setEnv("FEEDBACK_NOTIFY_EMAIL", "me@friendloop.test");
  await rows("alter table outbox rename to outbox_away");
  try {
    const result = await submitFeedback({ message: "Still here", path: "/", userAgent: "T", viewport: "1×1", ip: "198.51.100.200" }, null);
    assert.deepEqual(result, { ok: true });
  } finally {
    await rows("alter table outbox_away rename to outbox");
  }
  assert.equal((await rows("select id from feedback where message = 'Still here'")).length, 1);
});

test("a failure while moving an account isn't mistaken for an address in use", async () => {
  const id = await ownerUserId("stuck@friendloop.test");
  await requestEmailChange({ id, email: "stuck@friendloop.test" }, "free@friendloop.test");
  const token = await changeLink("free@friendloop.test");
  await rows("alter table magic_links rename to magic_links_away");
  try {
    await assert.rejects(confirmEmailChange(token));
  } finally {
    await rows("alter table magic_links_away rename to magic_links");
  }
  const [row] = await rows<{ email: string }>("select email from users where id = $1", [id]);
  assert.equal(row.email, "stuck@friendloop.test");
});

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Server } from "node:http";
import {
  flushOutbox,
  listUnsubscribeHeaders,
  sendEmail,
  suppressionFor,
  TRANSPORT_HEADER,
} from "../../src/lib/email/send.ts";
import {
  recordResendEvent,
  suppressionReasonOf,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../../src/lib/email/webhook.ts";
import { resolveUnsubscribe, safeBackPath, setMutedByToken } from "../../src/lib/unsubscribe.ts";
import { nudgeStragglers, sendPromptEmails } from "../../src/lib/notify.ts";
import { membersOf } from "../../src/lib/manage.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { groupOf, rows, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";
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

beforeEach(async () => {
  await failNextSends(0);
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const QUESTION = "What made you laugh this week?";
const SECRET = `whsec_${Buffer.from("a test signing key of some length").toString("base64")}`;

function sign(id: string, timestamp: number, body: string, secret = SECRET): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

/** Plain arrays, so deep equality does not trip over the driver's result class. */
async function plain<T>(sql: string, params?: unknown[]): Promise<T[]> {
  return [...(await rows<T>(sql, params ?? []))];
}

async function tokenOf(email: string): Promise<{ id: string; unsubscribe: string }> {
  const [row] = await rows<{ id: string; unsubscribe_token: string }>(
    "select id, unsubscribe_token from memberships where email = $1",
    [email],
  );
  return { id: row.id, unsubscribe: row.unsubscribe_token };
}

// ── Signature verification ───────────────────────────────────

test("a correctly signed webhook verifies", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"type":"email.delivered"}';
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, id: "msg_1", timestamp: String(ts), signature: sign("msg_1", ts, body), body, now }),
    { ok: true },
  );
});

test("any one of several signatures may match (a key rotation sends two)", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = "{}";
  const signature = `v1,bm90IGl0 v2,ignored ${sign("msg_2", ts, body)}`;
  assert.equal(verifyWebhookSignature({ secret: SECRET, id: "msg_2", timestamp: String(ts), signature, body, now }).ok, true);
});

test("a tampered body, a wrong key, or a malformed signature is refused", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const ts = Math.floor(now.getTime() / 1000);
  const body = '{"type":"email.bounced"}';
  const good = sign("msg_3", ts, body);
  const check = (input: Partial<Parameters<typeof verifyWebhookSignature>[0]>) =>
    verifyWebhookSignature({ secret: SECRET, id: "msg_3", timestamp: String(ts), signature: good, body, now, ...input });

  assert.deepEqual(check({ body: '{"type":"email.delivered"}' }), { ok: false, reason: "mismatch" });
  assert.deepEqual(check({ signature: sign("msg_3", ts, body, "whsec_b3RoZXIga2V5") }), { ok: false, reason: "mismatch" });
  assert.deepEqual(check({ signature: "v1" }), { ok: false, reason: "mismatch" });
  assert.deepEqual(check({ id: "msg_other" }), { ok: false, reason: "mismatch" });
});

test("missing headers or a missing secret are refused before any crypto", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const base = { secret: SECRET, id: "m", timestamp: "1", signature: "v1,x", body: "", now };
  assert.deepEqual(verifyWebhookSignature({ ...base, id: null }), { ok: false, reason: "missing" });
  assert.deepEqual(verifyWebhookSignature({ ...base, timestamp: null }), { ok: false, reason: "missing" });
  assert.deepEqual(verifyWebhookSignature({ ...base, signature: null }), { ok: false, reason: "missing" });
  assert.deepEqual(verifyWebhookSignature({ ...base, secret: "" }), { ok: false, reason: "missing" });
});

test("a replayed request with an old (or future, or junk) timestamp is refused even when correctly signed", () => {
  const now = new Date("2026-03-01T12:00:00Z");
  const body = "{}";
  const old = Math.floor(now.getTime() / 1000) - WEBHOOK_TOLERANCE_SECONDS - 1;
  const future = Math.floor(now.getTime() / 1000) + WEBHOOK_TOLERANCE_SECONDS + 1;
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, id: "r", timestamp: String(old), signature: sign("r", old, body), body, now }),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, id: "r", timestamp: String(future), signature: sign("r", future, body), body, now }),
    { ok: false, reason: "stale" },
  );
  assert.deepEqual(
    verifyWebhookSignature({ secret: SECRET, id: "r", timestamp: "12abc", signature: "v1,x", body, now }),
    { ok: false, reason: "stale" },
  );
  // Inside the window with a custom tolerance, the same old stamp passes.
  assert.equal(
    verifyWebhookSignature({
      secret: SECRET, id: "r", timestamp: String(old), signature: sign("r", old, body), body, now,
      toleranceSeconds: WEBHOOK_TOLERANCE_SECONDS * 2,
    }).ok,
    true,
  );
});

// ── Recording events ─────────────────────────────────────────

test("only a hard bounce or a complaint suppresses", () => {
  assert.equal(suppressionReasonOf({ type: "email.complained" }), "complaint");
  assert.equal(suppressionReasonOf({ type: "email.bounced", data: { bounce: { type: "Permanent" } } }), "bounce");
  assert.equal(suppressionReasonOf({ type: "email.bounced", data: {} }), "bounce");
  assert.equal(suppressionReasonOf({ type: "email.bounced", data: { bounce: null } }), "bounce");
  assert.equal(suppressionReasonOf({ type: "email.bounced", data: { bounce: { type: "Transient" } } }), null);
  assert.equal(suppressionReasonOf({ type: "email.delivered" }), null);
});

test("an event is linked to its outbox row, recorded once, and a delivery suppresses nothing", async () => {
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString(), [TRANSPORT_HEADER]: "resend" });
  const sent = await sendEmail({
    subject: "s", html: "<p>h</p>", text: "t", to: "reader@friendloop.test", kind: "prompt", dedupeKey: "prompt:link",
  });
  const [{ provider_id }] = await rows<{ provider_id: string }>("select provider_id from outbox where id = $1", [sent.emailId]);
  assert.match(provider_id, /^fake_/);

  const event = { type: "email.delivered", data: { email_id: provider_id, to: ["reader@friendloop.test"] } };
  assert.deepEqual(await recordResendEvent({ messageId: "msg_link", event }), { recorded: true, suppressed: [] });
  assert.deepEqual(await recordResendEvent({ messageId: "msg_link", event }), { recorded: false, suppressed: [] });

  const events = await plain<{ outbox_id: string; type: string; provider_id: string }>(
    "select outbox_id, type, provider_id from email_events",
  );
  assert.deepEqual(events, [{ outbox_id: sent.emailId, type: "email.delivered", provider_id }]);
  assert.equal((await rows("select * from email_suppressions")).length, 0);
});

test("a hard bounce suppresses the address; a later complaint upgrades the reason, a bounce never downgrades it", async () => {
  const bounced = await recordResendEvent({
    messageId: "msg_b1",
    event: { type: "email.bounced", data: { email_id: "re_unknown", to: ["Gone@Friendloop.test"], bounce: { type: "Permanent" } } },
  });
  assert.deepEqual(bounced, { recorded: true, suppressed: ["gone@friendloop.test"] });
  assert.deepEqual(
    await plain("select email, reason, provider_id from email_suppressions"),
    [{ email: "gone@friendloop.test", reason: "bounce", provider_id: "re_unknown" }],
  );
  // No outbox row has this id: the event is still kept, unlinked.
  const [unlinked] = await rows<{ outbox_id: string | null }>("select outbox_id from email_events");
  assert.equal(unlinked.outbox_id, null);

  await recordResendEvent({ messageId: "msg_c1", event: { type: "email.complained", data: { email_id: "re_2", to: "gone@friendloop.test" } } });
  await recordResendEvent({ messageId: "msg_b2", event: { type: "email.bounced", data: { email_id: "re_3", to: ["gone@friendloop.test"] } } });
  assert.deepEqual(
    await plain("select reason, provider_id from email_suppressions"),
    [{ reason: "complaint", provider_id: "re_3" }],
  );
});

test("a bounce with no recipient in the payload falls back to the outbox row's address", async () => {
  await rows(
    "insert into outbox (\"to\", subject, html, text, kind, dedupe_key, status, provider_id) values ('Old@friendloop.test', 's', 'h', 't', 'prompt', 'prompt:fallback', 'sent', 're_fallback')",
  );
  const result = await recordResendEvent({ messageId: "msg_fb", event: { type: "email.bounced", data: { email_id: "re_fallback" } } });
  assert.deepEqual(result.suppressed, ["old@friendloop.test"]);

  // No id and no recipient: recorded, nothing to suppress.
  const bare = await recordResendEvent({ messageId: "msg_bare", event: { type: "email.bounced", data: { to: [42] } } });
  assert.deepEqual(bare, { recorded: true, suppressed: [] });
  const [{ type, provider_id }] = await rows<{ type: string; provider_id: string }>(
    "select type, provider_id from email_events where message_id = 'msg_bare'",
  );
  assert.equal(type, "email.bounced");
  assert.equal(provider_id, "");

  const odd = await recordResendEvent({ messageId: "msg_odd", event: { type: 7 } as never });
  assert.equal(odd.recorded, true);
  assert.equal((await rows<{ type: string }>("select type from email_events where message_id = 'msg_odd'"))[0].type, "unknown");
});

// ── Suppression at send time ─────────────────────────────────

test("a suppressed address gets loop mail recorded as suppressed, never sent; sign-in links still go", async () => {
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString(), [TRANSPORT_HEADER]: "resend" });
  await rows("insert into email_suppressions (email, reason) values ('bad@friendloop.test', 'bounce')");
  const before = (await providerLog()).length;

  const loopMail = await sendEmail({
    subject: "s", html: "h", text: "t", to: " BAD@friendloop.test", kind: "delivery", dedupeKey: "delivery:suppressed",
  });
  assert.equal(loopMail.queued, false);
  const signIn = await sendEmail({
    subject: "s", html: "h", text: "t", to: "bad@friendloop.test", kind: "signin", dedupeKey: "signin:suppressed",
  });
  assert.equal(signIn.queued, true);

  const outbox = await plain<{ kind: string; status: string; suppressed_reason: string | null }>(
    "select kind, status, suppressed_reason from outbox order by kind::text",
  );
  assert.deepEqual(outbox, [
    { kind: "delivery", status: "suppressed", suppressed_reason: "bounce" },
    { kind: "signin", status: "sent", suppressed_reason: null },
  ]);
  assert.equal((await providerLog()).length, before + 1, "only the sign-in link reached the provider");
});

test("a retry re-checks: a failed send to an address that has since bounced is suppressed, not retried", async () => {
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString(), [TRANSPORT_HEADER]: "resend" });
  await failNextSends(1);
  await sendEmail({ subject: "s", html: "h", text: "t", to: "later@friendloop.test", kind: "prompt", dedupeKey: "prompt:retry" });
  assert.equal((await rows<{ status: string }>("select status from outbox"))[0].status, "failed");

  await rows("insert into email_suppressions (email, reason) values ('later@friendloop.test', 'complaint')");
  assert.equal(await flushOutbox(), 1);
  assert.deepEqual(await plain("select status, suppressed_reason from outbox"), [
    { status: "suppressed", suppressed_reason: "complaint" },
  ]);
  assert.equal(await flushOutbox(), 0, "a suppressed row is never picked up again");
});

// ── Headers ──────────────────────────────────────────────────

test("a loop email carries List-Unsubscribe and one-click headers to the provider, and keeps them for retries", async () => {
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString(), [TRANSPORT_HEADER]: "resend" });
  const token = "a".repeat(64);
  const expected = listUnsubscribeHeaders(token);
  assert.deepEqual(expected, {
    "List-Unsubscribe": `<http://localhost:3100/api/unsubscribe/${token}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });

  await sendEmail({
    subject: "Headers", html: "h", text: "t", to: "hdr@friendloop.test", kind: "prompt", dedupeKey: "prompt:hdr", unsubscribeToken: token,
  });
  const sent = (await providerLog()).filter((entry) => entry.subject === "Headers");
  assert.deepEqual(sent.at(-1)?.headers, expected);

  await failNextSends(1);
  await sendEmail({
    subject: "Retry headers", html: "h", text: "t", to: "hdr@friendloop.test", kind: "prompt", dedupeKey: "prompt:hdr2", unsubscribeToken: token,
  });
  await flushOutbox();
  const retried = (await providerLog()).filter((entry) => entry.subject === "Retry headers");
  assert.deepEqual(retried.at(-1)?.headers, expected, "the retry sends the same headers");

  // Sign-in links have no unsubscribe token and no headers.
  await sendEmail({ subject: "Sign in", html: "h", text: "t", to: "hdr@friendloop.test", kind: "signin", dedupeKey: "signin:hdr" });
  assert.equal((await providerLog()).filter((entry) => entry.subject === "Sign in").at(-1)?.headers, undefined);
  const [row] = await rows<{ headers: unknown }>("select headers from outbox where dedupe_key = 'signin:hdr'");
  assert.equal(row.headers, null);
});

// ── Mute ─────────────────────────────────────────────────────

test("an unsubscribe token resolves only to a live membership, and mute/unmute round-trips", async () => {
  await seedLoop();
  const alice = await tokenOf("alice@friendloop.test");
  assert.match(alice.unsubscribe, /^[0-9a-f]{64}$/);

  assert.deepEqual(await resolveUnsubscribe("not-a-token"), { state: "invalid" });
  assert.deepEqual(await resolveUnsubscribe("0".repeat(64)), { state: "invalid" });
  assert.equal(await setMutedByToken("0".repeat(64), true), false);

  const open = await resolveUnsubscribe(alice.unsubscribe);
  assert.equal(open.state === "ok" && open.muted, false);
  assert.equal(open.state === "ok" && open.groupName, "Friday Loop");

  assert.equal(await setMutedByToken(alice.unsubscribe, true), true);
  const [{ muted_at: first }] = await rows<{ muted_at: Date }>("select muted_at from memberships where id = $1", [alice.id]);
  assert.equal(new Date(first).toISOString(), AFTER_FIRST_SLOT.toISOString());

  // Muting again keeps when they first asked.
  setRequestHeaders({ "x-e2e-now": DELIVERY_DAY.toISOString() });
  await setMutedByToken(alice.unsubscribe, true);
  const [{ muted_at: second }] = await rows<{ muted_at: Date }>("select muted_at from memberships where id = $1", [alice.id]);
  assert.equal(new Date(second).toISOString(), AFTER_FIRST_SLOT.toISOString());
  const muted = await resolveUnsubscribe(alice.unsubscribe);
  assert.equal(muted.state === "ok" && muted.muted, true);

  assert.equal(await setMutedByToken(alice.unsubscribe, false), true);
  const back = await resolveUnsubscribe(alice.unsubscribe);
  assert.equal(back.state === "ok" && back.muted, false);

  // A removed member's link is no longer theirs to use.
  await rows("update memberships set revoked_at = now() where id = $1", [alice.id]);
  assert.deepEqual(await resolveUnsubscribe(alice.unsubscribe), { state: "invalid" });
});

test("the unsubscribe token is not the reply token, and every membership has its own", async () => {
  const loop = await seedLoop();
  const tokens = await rows<{ reply_token: string; unsubscribe_token: string }>(
    "select reply_token, unsubscribe_token from memberships",
  );
  assert.equal(tokens.length, loop.members.length);
  assert.equal(new Set(tokens.map((row) => row.unsubscribe_token)).size, tokens.length);
  for (const row of tokens) assert.notEqual(row.reply_token, row.unsubscribe_token);
});

test("a back path must stay on this site", () => {
  assert.equal(safeBackPath("/r/abc"), "/r/abc");
  assert.equal(safeBackPath("/i/x?m=y"), "/i/x?m=y");
  assert.equal(safeBackPath("//evil.example"), null);
  assert.equal(safeBackPath("/\\evil.example"), null);
  assert.equal(safeBackPath("https://evil.example"), null);
  assert.equal(safeBackPath(null), null);
});

test("a muted member gets no prompt; it is recorded as suppressed, and everyone else is prompted", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const group = await groupOf(loop.groupId);
  const alice = await tokenOf("alice@friendloop.test");
  await setMutedByToken(alice.unsubscribe, true);

  const sent = await sendPromptEmails({
    group, issueId: issue.issueId, issueNumber: issue.number, deliversAt: DELIVERY_DAY, questionCount: 1,
  });
  assert.equal(sent, 2, "owner and bob");
  const mail = await rows<{ to: string; status: string; suppressed_reason: string | null; html: string; text: string }>(
    "select \"to\", status, suppressed_reason, html, text from outbox where kind = 'prompt' order by \"to\"",
  );
  assert.deepEqual(
    mail.map(({ to, status, suppressed_reason }) => ({ to, status, suppressed_reason })),
    [
      { to: "alice@friendloop.test", status: "suppressed", suppressed_reason: "muted" },
      { to: "bob@friendloop.test", status: "sent", suppressed_reason: null },
      { to: "owner@friendloop.test", status: "sent", suppressed_reason: null },
    ],
  );
  // Each email's footer link and plain-text line point at that member's own page.
  const bob = await tokenOf("bob@friendloop.test");
  const bobMail = mail.find((row) => row.to === "bob@friendloop.test")!;
  assert.ok(bobMail.html.includes(`/u/${bob.unsubscribe}`));
  assert.ok(bobMail.html.includes("Stop emails from this loop"));
  assert.ok(bobMail.text.includes(`Stop emails from this loop: http://localhost:3100/u/${bob.unsubscribe}`));

  // Muting is per loop membership, not per address: the sign-in path is untouched.
  assert.equal(await suppressionFor({ to: "alice@friendloop.test", kind: "signin", membershipId: alice.id }), null);
});

test("a muted member gets no reminder, no nudge and no issue email, and unmuting brings them back", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = await tokenOf("alice@friendloop.test");
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await setMutedByToken(alice.unsubscribe, true);

  const reminded = (await sweep({ at: new Date(DELIVERY_DAY.getTime() - 24 * HOUR) })).reminded;
  assert.equal(reminded, 2, "owner and bob; alice is muted");
  assert.equal(await nudgeStragglers(loop.groupId), 2);

  await seedReplies({ issueId: issue.issueId, membershipId: bob.id, answers: [{ text: QUESTION, body: "Geese." }], submittedAt: AFTER_FIRST_SLOT });
  await sweep({ at: DELIVERY_DAY });

  const byKind = await rows<{ kind: string; to: string; status: string }>(
    "select kind, \"to\", status from outbox where \"to\" = 'alice@friendloop.test' order by kind",
  );
  assert.ok(byKind.length >= 3);
  for (const row of byKind) assert.equal(row.status, "suppressed", `${row.kind} to alice is held back`);

  const delivered = await rows<{ to: string; html: string }>(
    "select \"to\", html from outbox where kind = 'delivery' and status = 'sent' order by \"to\"",
  );
  assert.deepEqual(delivered.map((row) => row.to), ["bob@friendloop.test", "owner@friendloop.test"]);
  const owner = await tokenOf("owner@friendloop.test");
  const ownerMail = delivered.find((row) => row.to === "owner@friendloop.test")!;
  assert.ok(ownerMail.html.includes(`/u/${owner.unsubscribe}`), "the issue email is rendered per member");

  // Unmuted, the next nudge reaches them again.
  await setMutedByToken(alice.unsubscribe, false);
  const issue2 = await seedOpenIssue(loop, { openedAt: DELIVERY_DAY });
  assert.ok(issue2.issueId);
  setRequestHeaders({ "x-e2e-now": DELIVERY_DAY.toISOString() });
  await nudgeStragglers(loop.groupId);
  const [latest] = await rows<{ status: string }>(
    "select status from outbox where \"to\" = 'alice@friendloop.test' and dedupe_key like $1",
    [`manual-reminder:${issue2.issueId}:%`],
  );
  assert.equal(latest.status, "sent");
});

test("the members list shows who is muted and whose address is bouncing", async () => {
  const loop = await seedLoop();
  const alice = await tokenOf("alice@friendloop.test");
  await setMutedByToken(alice.unsubscribe, true);
  await rows("insert into email_suppressions (email, reason) values ('bob@friendloop.test', 'bounce')");

  const people = await membersOf(loop.groupId);
  const status = Object.fromEntries(people.map((person) => [person.email, { muted: person.mutedAt !== null, suppression: person.suppression }]));
  assert.deepEqual(status["alice@friendloop.test"], { muted: true, suppression: null });
  assert.deepEqual(status["bob@friendloop.test"], { muted: false, suppression: "bounce" });
  assert.deepEqual(status["owner@friendloop.test"], { muted: false, suppression: null });
});

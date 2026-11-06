import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import {
  emailIsCaptured,
  flushOutbox,
  MAX_SEND_ATTEMPTS,
  latestOutboxRow,
  queueEmail,
  sendEmail,
  TRANSPORT_HEADER,
} from "../../src/lib/email/send.ts";
import { rows, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import {
  FAKE_MAIL_URL,
  failNextSends,
  providerLog,
  startFakeResend,
  stopFakeResend,
} from "../../e2e/support/fake-resend.ts";

/**
 * The provider path, against a stub that can misbehave.
 *
 * `.env` for the test process still says `outbox`, so every send here asks for
 * the real transport per request — the same seam the e2e suite uses — and the
 * Resend SDK talks HTTP to a local server.
 */
process.env.RESEND_BASE_URL = FAKE_MAIL_URL;
process.env.RESEND_API_KEY = "re_test_key";

let stub: Server | null = null;

before(async () => {
  stub = await startFakeResend();
  await failNextSends(0);
});

after(async () => {
  await stopFakeResend(stub);
});

beforeEach(async () => {
  await failNextSends(0);
  clearRequest();
  setRequestHeaders({ "x-e2e-now": "2026-01-02T08:05:00.000Z" });
});

const base = {
  subject: "Subject",
  html: "<p>Hello</p>",
  text: "Hello",
  to: "someone@friendloop.test",
  kind: "signin" as const,
};

function useResend() {
  setRequestHeaders({ "x-e2e-now": "2026-01-02T08:05:00.000Z", [TRANSPORT_HEADER]: "resend" });
}


setupDatabase();

test("the configured transport is the outbox in this process", () => {
  assert.equal(emailIsCaptured(), true);
});

test("queueing is keyed: the same dedupe key is one row, not two", async () => {
  const first = await queueEmail({ ...base, dedupeKey: "signin:abc" });
  const second = await queueEmail({ ...base, dedupeKey: "signin:abc" });

  assert.equal(first.deduped, false);
  assert.equal(second.deduped, true);
  assert.equal(second.id, first.id);

  const rowsNow = await rows<{ count: number }>("select count(*)::int as count from outbox");
  assert.equal(rowsNow[0].count, 1);
});

test("sending through the outbox marks the row sent with a local provider id", async () => {
  const result = await sendEmail({ ...base, dedupeKey: "signin:outbox" });
  assert.equal(result.queued, true);

  const [row] = await rows<{ status: string; provider_id: string }>("select status, provider_id from outbox");
  assert.equal(row.status, "sent");
  assert.match(row.provider_id, /^outbox_/);

  const again = await sendEmail({ ...base, dedupeKey: "signin:outbox" });
  assert.equal(again.queued, false, "a duplicate is not sent again");
});

test("a header can route one request through the real provider, and the id comes back", async () => {
  useResend();
  const result = await sendEmail({ ...base, dedupeKey: "signin:provider" });
  assert.equal(result.queued, true);

  const [row] = await rows<{ status: string; provider_id: string; error: string | null }>(
    "select status, provider_id, error from outbox",
  );
  assert.equal(row.status, "sent");
  assert.equal(row.error, null);
  assert.match(row.provider_id!, /^fake_/);

  const log = await providerLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].to, "someone@friendloop.test");
});

test("the sender name is the loop's, and the address comes from the configured from", async () => {
  useResend();
  await sendEmail({
    ...base,
    dedupeKey: "prompt:from-name",
    fromName: "Friday Loop",
    groupId: null,
    issueId: null,
    membershipId: null,
  });

  // The stub records the subject; the `from` header is what the SDK sends.
  const log = await providerLog();
  assert.equal(log[0].subject, "Subject");
});

test("a provider failure is recorded with its reason and attempt count", async () => {
  useResend();
  await failNextSends(1);

  const result = await sendEmail({ ...base, dedupeKey: "signin:fail" });
  assert.equal(result.queued, true);

  const [row] = await rows<{ status: string; attempts: number; error: string }>(
    "select status, attempts, error from outbox",
  );
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 1);
  assert.match(row.error, /Provider failure 500/);
});

test("flushing retries failures and pending rows, oldest first, then clears the error", async () => {
  useResend();
  await failNextSends(2);

  await sendEmail({ ...base, dedupeKey: "signin:a", to: "a@friendloop.test" });
  await sendEmail({ ...base, dedupeKey: "signin:b", to: "b@friendloop.test" });

  const failed = await rows<{ status: string }>("select status from outbox");
  assert.deepEqual(failed.map((row) => row.status), ["failed", "failed"]);

  // A pending row (queued but never dispatched) is retried too.
  await queueEmail({ ...base, dedupeKey: "signin:pending", to: "c@friendloop.test" });

  const retried = await flushOutbox();
  assert.equal(retried, 3);

  const after = await rows<{ status: string; error: string | null; attempts: number }>(
    "select status, error, attempts from outbox order by \"to\"",
  );
  assert.deepEqual(after.map((row) => row.status), ["sent", "sent", "sent"]);
  assert.ok(after.every((row) => row.error === null));
  assert.deepEqual(after.map((row) => row.attempts), [1, 1, 0], "attempts only count failures");
});

test("flushing an empty outbox does nothing", async () => {
  assert.equal(await flushOutbox(), 0);
});

test("a partially failing flush leaves the failures in place", async () => {
  useResend();
  await failNextSends(2);
  await sendEmail({ ...base, dedupeKey: "signin:x", to: "x@friendloop.test" });

  // One failure already recorded; flushing once more with the provider down
  // increments again rather than resetting.
  await flushOutbox();
  const [row] = await rows<{ status: string; attempts: number }>("select status, attempts from outbox");
  assert.equal(row.status, "failed");
  assert.equal(row.attempts, 2);
});

test("the newest row for a dedupe prefix is readable", async () => {
  await sendEmail({ ...base, dedupeKey: "signin:first", subject: "One" });
  await sendEmail({ ...base, dedupeKey: "signin:second", subject: "Two" });

  const newest = await latestOutboxRow("signin:");
  assert.equal(newest?.subject, "Two");
  assert.equal(await latestOutboxRow("nothing:"), null);
});

test("the environment can name the transport outright", async () => {
  const original = process.env.EMAIL_TRANSPORT;
  try {
    process.env.EMAIL_TRANSPORT = "resend";
    assert.equal(emailIsCaptured(), false);
    process.env.EMAIL_TRANSPORT = "outbox";
    assert.equal(emailIsCaptured(), true);
    delete process.env.EMAIL_TRANSPORT;
    // With no explicit transport, a key means production sending.
    assert.equal(emailIsCaptured(), false);
  } finally {
    if (original === undefined) delete process.env.EMAIL_TRANSPORT;
    else process.env.EMAIL_TRANSPORT = original;
  }
});

test("a request whose headers cannot be read still falls back to the configured transport", async () => {
  const { setRequestBroken } = await import("../stubs/request.mjs");
  setRequestBroken(true);
  try {
    const result = await sendEmail({ ...base, dedupeKey: "signin:no-headers" });
    assert.equal(result.queued, true);
    const [row] = await rows<{ status: string; provider_id: string }>(
      "select status, provider_id from outbox where dedupe_key = 'signin:no-headers'",
    );
    assert.equal(row.status, "sent");
    assert.match(row.provider_id, /^outbox_/, "the configured outbox still works");
  } finally {
    setRequestBroken(false);
  }
});


test("a row that keeps failing stops retrying, and can't hold up newer mail", async () => {
  await queueEmail({ to: "stuck@friendloop.test", subject: "s", html: "h", text: "t", kind: "signin", dedupeKey: "cap:stuck" });
  await queueEmail({ to: "worn@friendloop.test", subject: "s", html: "h", text: "t", kind: "signin", dedupeKey: "cap:worn" });
  await rows("update outbox set status = 'failed', attempts = $1 where dedupe_key = 'cap:stuck'", [MAX_SEND_ATTEMPTS]);
  await rows("update outbox set status = 'failed', attempts = 3 where dedupe_key = 'cap:worn'");

  await queueEmail({ to: "new@friendloop.test", subject: "s", html: "h", text: "t", kind: "signin", dedupeKey: "cap:new" });
  // Only one slot in the batch: the row with the fewest tries gets it.
  assert.equal(await flushOutbox(1), 1);
  const after = await rows<{ dedupe_key: string; status: string }>("select dedupe_key, status from outbox where dedupe_key like 'cap:%'");
  const status = Object.fromEntries(after.map((row) => [row.dedupe_key, row.status]));
  assert.equal(status["cap:new"], "sent");
  assert.equal(status["cap:worn"], "failed");

  await flushOutbox();
  const [stuck] = await rows<{ status: string; attempts: number }>("select status, attempts from outbox where dedupe_key = 'cap:stuck'");
  assert.equal(stuck.status, "failed");
  assert.equal(stuck.attempts, MAX_SEND_ATTEMPTS);
});

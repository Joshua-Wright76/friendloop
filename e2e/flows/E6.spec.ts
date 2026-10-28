import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedOpenIssue, seedLoop, seedReplies, type SeedLoopInput } from "../support/seed";
import { AFTER_FIRST_SLOT, APP, DELIVERY_DAY, runSweep } from "../support/harness";

const REPLY_DOMAIN = process.env.EMAIL_REPLY_DOMAIN ?? "inbound.friendloop.test";
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "whsec_ZnJpZW5kbG9vcC1pbmJvdW5kLXRlc3Qtc2VjcmV0";

test.beforeEach(async () => {
  await resetDatabase();
});

async function deliveryFor(recipientEmail = "alice@friendloop.test", loopInput: SeedLoopInput = {}) {
  const loop = await seedLoop(loopInput);
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const writer = loop.members.find((member) => member.participation === "contributor")!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: writer.id,
    answers: [{ text: "What made you laugh this week?", body: "The cat fist bump." }],
  });
  await runSweep(DELIVERY_DAY);

  const [delivery] = await rows<{ reply_token: string; issue_id: string; membership_id: string }>(
    "select reply_token, issue_id, membership_id from outbox where kind = 'delivery' and \"to\" = $1",
    [recipientEmail],
  );
  expect(delivery.reply_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  return { loop, issue, delivery };
}

async function postInbound(input: {
  token: string;
  from?: string;
  to?: string;
  emailId?: string;
  text?: string;
  html?: string;
  invalidSignature?: boolean;
}) {
  const payload = JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: {
      email_id: input.emailId ?? randomUUID(),
      created_at: new Date().toISOString(),
      from: input.from ?? "alice@friendloop.test",
      to: [input.to ?? `loop+${input.token}@${REPLY_DOMAIN}`],
      bcc: [],
      cc: [],
      received_for: [],
      message_id: `<${randomUUID()}@friendloop.test>`,
      subject: "Re: Friday Loop · round 1",
      attachments: [],
    },
  });
  const id = `evt_${randomUUID()}`;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = Buffer.from(WEBHOOK_SECRET.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${payload}`).digest("base64");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": timestamp,
    "webhook-signature": input.invalidSignature ? "v1,invalid" : `v1,${signature}`,
  };
  if (input.text !== undefined) headers["x-e2e-inbound-text"] = Buffer.from(input.text).toString("base64");
  if (input.html !== undefined) headers["x-e2e-inbound-html"] = Buffer.from(input.html).toString("base64");

  return fetch(`${APP}/api/email/inbound`, { method: "POST", headers, body: payload });
}

test("E6 · an emailed reply becomes one attributed comment, even when the webhook repeats", async ({ page }) => {
  const { loop, delivery } = await deliveryFor();
  const emailId = randomUUID();
  const input = {
    token: delivery.reply_token,
    emailId,
    text: "This made my morning.\n\n-- \nAlice\n\nOn Fri, Jan 9, 2026 at 9:00 AM Friday Loop wrote:\n> Round 1",
  };

  const first = await postInbound(input);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ ok: true, commented: true });

  const repeated = await postInbound(input);
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toEqual({ ok: true, deduped: true });

  const saved = await rows<{ body: string; membership_id: string; inbound_email_id: string }>(
    "select body, membership_id, inbound_email_id from comments",
  );
  expect(saved).toEqual([{ body: "This made my morning.", membership_id: delivery.membership_id, inbound_email_id: emailId }]);

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await page.goto(`/i/${delivery.issue_id}?m=${alice.token}`);
  await expect(page.getByText("This made my morning.")).toBeVisible();
});

test("E6 · bad signatures, wrong senders, and unknown tokens write nothing", async () => {
  const { delivery } = await deliveryFor();

  const badSignature = await postInbound({ token: delivery.reply_token, text: "Not valid.", invalidSignature: true });
  expect(badSignature.status).toBe(401);

  const wrongSender = await postInbound({ token: delivery.reply_token, from: "bob@friendloop.test", text: "Not Alice." });
  expect(wrongSender.status).toBe(200);
  expect(await wrongSender.json()).toEqual({ ok: true, ignored: "sender" });

  const unknown = await postInbound({ token: "z".repeat(43), text: "No delivery token." });
  expect(unknown.status).toBe(200);
  expect(await unknown.json()).toEqual({ ok: true, ignored: "membership" });

  expect(await rows("select id from comments")).toHaveLength(0);
});

test("E6 · a revoked member cannot comment by email", async () => {
  const { delivery } = await deliveryFor();
  await rows("update memberships set revoked_at = now() where id = $1", [delivery.membership_id]);

  const response = await postInbound({ token: delivery.reply_token, text: "Should not appear." });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, ignored: "membership" });
  expect(await rows("select id from comments")).toHaveLength(0);
});

test("E6 · readers can reply in from_you mode, while empty and oversized mail is ignored", async () => {
  const readerEmail = "reader@friendloop.test";
  const { delivery } = await deliveryFor(readerEmail, {
    mode: "from_you",
    members: [{ email: readerEmail, name: "Reader", participation: "reader" }],
  });

  const fromReader = await postInbound({
    token: delivery.reply_token,
    from: readerEmail,
    text: undefined,
    html: "<div>A note from the reader &amp; friend.</div><blockquote>Quoted issue</blockquote>",
  });
  expect(fromReader.status).toBe(200);
  expect(await fromReader.json()).toEqual({ ok: true, commented: true });

  const empty = await postInbound({ token: delivery.reply_token, from: readerEmail, text: "> Only quoted text" });
  expect(await empty.json()).toEqual({ ok: true, ignored: "empty" });

  const oversized = await postInbound({ token: delivery.reply_token, from: readerEmail, text: "x".repeat(2001) });
  expect(await oversized.json()).toEqual({ ok: true, ignored: "too-long" });

  const saved = await rows<{ body: string; membership_id: string }>("select body, membership_id from comments");
  expect(saved).toEqual([{ body: "A note from the reader & friend.", membership_id: delivery.membership_id }]);
});

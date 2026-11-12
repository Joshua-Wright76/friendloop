import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedOpenIssue } from "../support/seed";
import { APP, DELIVERY_DAY, HOUR, runSweep, signIn } from "../support/harness";
import { postResendEvent } from "../support/webhooks";
import { copy, copyPattern } from "@/lib/copy";
import { openPerson, personRow } from "../support/people";

test.beforeEach(async () => {
  await resetDatabase();
});

const OPENED = new Date("2026-01-02T08:00:00Z");

test("U2 · only a correctly signed, fresh webhook is accepted, and a redelivery is recorded once", async () => {
  const event = { type: "email.delivered", data: { email_id: "re_t2_delivered", to: ["bob@friendloop.test"] } };

  const forged = await postResendEvent(event, { id: "msg_forged", secret: "whsec_bm90IHRoZSBzZWNyZXQ=" });
  expect(forged.status).toBe(401);

  // Signed correctly, but captured long ago: a replay.
  const replayed = await postResendEvent(event, { id: "msg_old", at: new Date(Date.now() - 60 * 60 * 1000) });
  expect(replayed.status).toBe(401);

  const unsigned = await fetch(`${APP}/api/webhooks/resend`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event),
  });
  expect(unsigned.status).toBe(401);
  expect(await rows("select id from email_events")).toHaveLength(0);

  const good = await postResendEvent(event, { id: "msg_good" });
  expect(good.status).toBe(200);
  const again = await postResendEvent(event, { id: "msg_good" });
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ ok: true, duplicate: true });
  expect(await rows("select id from email_events")).toHaveLength(1);
});

test("U2 · a hard bounce suppresses the address, links to the outbox row, and shows on the people tab", async ({ page }) => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: OPENED });

  // A prompt that went out, with the id the provider gave it.
  await rows(
    "insert into outbox (\"to\", subject, html, text, kind, dedupe_key, status, provider_id, group_id, membership_id) select 'bob@friendloop.test', 's', 'h', 't', 'prompt', 'prompt:t2', 'sent', 're_t2_bounce', group_id, id from memberships where email = 'bob@friendloop.test'",
  );

  const response = await postResendEvent(
    { type: "email.bounced", data: { email_id: "re_t2_bounce", to: ["bob@friendloop.test"], bounce: { type: "Permanent" } } },
    { id: "msg_bounce" },
  );
  expect(response.status).toBe(200);

  const [event] = await rows<{ type: string; outbox_id: string | null }>("select type, outbox_id from email_events");
  expect(event.type).toBe("email.bounced");
  expect(event.outbox_id).not.toBeNull();
  expect(await rows("select email, reason from email_suppressions")).toEqual([
    { email: "bob@friendloop.test", reason: "bounce" },
  ]);

  // The next loop email to that address is recorded, not sent.
  await runSweep(new Date(DELIVERY_DAY.getTime() - 24 * HOUR));
  const [reminder] = await rows<{ status: string; suppressed_reason: string }>(
    "select status, suppressed_reason from outbox where kind = 'reminder' and \"to\" = 'bob@friendloop.test'",
  );
  expect(reminder).toEqual({ status: "suppressed", suppressed_reason: "bounce" });

  await signIn(page, "owner@friendloop.test");
  await page.goto(`/g/${loop.groupId}/members`);
  // The row says so on its quiet line; opening it shows what to do.
  await expect(personRow(page, "Bob").getByText(copy.members.bouncing)).toBeVisible();
  const bob = await openPerson(page, "Bob");
  await expect(bob.getByText(copy.members.bouncing, { exact: true })).toBeVisible();
  await expect(bob.getByText(copyPattern(copy.members.bouncingHint))).toBeVisible();
});

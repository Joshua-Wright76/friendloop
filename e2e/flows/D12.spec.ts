import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, runSweep } from "../support/harness";
import { failNextSends, providerLog } from "../support/fake-resend";

test.beforeEach(async () => {
  await resetDatabase();
  await failNextSends(0);
});

/**
 * The outbox transport stops before `dispatch()` ever calls a provider, so the
 * failure path — the one that keeps a broken send in the table for the next
 * sweep — only runs in production. This drives the real SDK against a stub that
 * can reject, so the retry is proven rather than assumed.
 */
test("D12 · a provider outage leaves the mail queued and the next sweep sends it", async () => {
  await seedLoop();

  // Fail every send in the first sweep, including the retry it ends with.
  await failNextSends(6);
  const first = await runSweep(AFTER_FIRST_SLOT, { transport: "resend" });
  expect(first.opened).toBe(1);

  const failed = await rows<{ status: string; attempts: number; error: string | null }>(
    "select status, attempts, error from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(failed).toHaveLength(3);
  for (const row of failed) {
    expect(row.status).toBe("failed");
    expect(row.attempts, "the first attempt and the retry inside the same sweep").toBe(2);
    expect(row.error).toContain("Provider failure 500");
  }

  // The next sweep retries what is already recorded — it does not queue again.
  const second = await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + 60_000), {
    transport: "resend",
  });
  expect(second.opened).toBe(0);
  expect(second.retried, "three failed rows retried").toBe(3);

  const sent = await rows<{ status: string; provider_id: string | null; attempts: number }>(
    "select status, provider_id, attempts from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(sent).toHaveLength(3);
  for (const row of sent) {
    expect(row.status).toBe("sent");
    expect(row.provider_id, "the provider id the SDK returned").toMatch(/^fake_/);
    expect(row.attempts, "attempts are history, not a reset").toBe(2);
  }

  const log = await providerLog();
  expect(new Set(log.map((entry) => entry.to))).toEqual(
    new Set(["alice@friendloop.test", "bob@friendloop.test", "owner@friendloop.test"]),
  );
  // Three sends, each attempted three times: the first sweep, the retry it ends
  // with, and the next sweep. The SDK really left the building every time.
  expect(log).toHaveLength(9);
});

test("D12 · a permanent rejection is recorded with the provider's reason", async () => {
  const loop = await seedLoop();
  await rows("update memberships set email = 'rejected@friendloop.test' where email = 'bob@friendloop.test'");

  const report = await runSweep(AFTER_FIRST_SLOT, { transport: "resend" });
  expect(report.opened).toBe(1);

  const bounced = await rows<{ status: string; error: string | null; membership_id: string }>(
    "select status, error, membership_id from outbox where \"to\" = 'rejected@friendloop.test'",
  );
  expect(bounced).toHaveLength(1);
  expect(bounced[0].status).toBe("failed");
  expect(bounced[0].error).toContain("The mail server rejected the message.");

  const others = await rows<{ status: string }>(
    "select status from outbox where kind = 'prompt' and \"to\" <> 'rejected@friendloop.test'",
  );
  expect(others.map((row) => row.status)).toEqual(["sent", "sent"]);

  // The rejected address is a member of this loop; the failed row is the only
  // thing that survives for it.
  const member = loop.members.find((candidate) => candidate.email === "bob@friendloop.test")!;
  expect(bounced[0].membership_id).toBe(member.id);
});

test("D12 · a rate limit is retried, and clears once the provider recovers", async () => {
  await seedLoop();

  // 429 for every send in this sweep, the retry inside it included.
  await failNextSends(6, 429);
  await runSweep(AFTER_FIRST_SLOT, { transport: "resend" });

  const throttled = await rows<{ status: string; error: string | null }>(
    "select status, error from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(throttled).toHaveLength(3);
  for (const row of throttled) {
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/Too many requests/i);
  }

  const retry = await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + 60_000), { transport: "resend" });
  expect(retry.retried).toBe(3);

  const recovered = await rows<{ status: string; error: string | null }>(
    "select status, error from outbox where kind = 'prompt' order by \"to\"",
  );
  expect(recovered.map((row) => row.status)).toEqual(["sent", "sent", "sent"]);
  expect(recovered.every((row) => row.error === null)).toBe(true);
});

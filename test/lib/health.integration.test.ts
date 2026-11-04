import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pingDatabase, readHealth, recordHeartbeat, SWEEP_HEARTBEAT } from "../../src/lib/health.ts";
import { OUTBOX_STUCK_AFTER_MS } from "../../src/lib/health-report.ts";
import { runSweep, SWEEP_MONITOR_CONFIG, SWEEP_MONITOR_SLUG } from "../../src/lib/sweep-run.ts";
import { log } from "../../src/lib/log.ts";
import { AFTER_FIRST_SLOT, HOUR, resetDatabase, rows, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { calls as sentryCalls, reset as resetSentry } from "../stubs/sentry-nextjs.mjs";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

const AT = AFTER_FIRST_SLOT;
const originalVercelEnv = process.env.VERCEL_ENV;

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  resetSentry();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AT.toISOString() });
});

afterEach(() => setEnv("VERCEL_ENV", originalVercelEnv));

async function queueOutboxRow(input: { key: string; status: "pending" | "sent" | "failed"; createdAt: Date }) {
  await rows(
    `insert into outbox ("to", subject, html, text, kind, dedupe_key, status, created_at)
     values ('a@example.com', 's', 'h', 't', 'signin', $1, $2, $3)`,
    [input.key, input.status, input.createdAt.toISOString()],
  );
}

test("without a recorded sweep the instance reports unhealthy", async () => {
  const report = await readHealth(AT);
  assert.equal(report.ok, false);
  assert.equal(report.checks.sweep.lastOkAt, null);
  assert.equal(report.checks.outbox.ok, true);
});

test("a recorded heartbeat is read back and upserted in place", async () => {
  await recordHeartbeat(SWEEP_HEARTBEAT, new Date(AT.getTime() - 2 * HOUR));
  await recordHeartbeat(SWEEP_HEARTBEAT, new Date(AT.getTime() - HOUR));
  const report = await readHealth(AT);
  assert.equal(report.ok, true);
  assert.equal(report.checks.sweep.hoursSince, 1);
  const beats = await rows("select * from heartbeats");
  assert.equal(beats.length, 1);
});

test("only old pending or failed mail counts as stuck", async () => {
  await recordHeartbeat(SWEEP_HEARTBEAT, AT);
  const old = new Date(AT.getTime() - OUTBOX_STUCK_AFTER_MS - 3 * HOUR);
  const fresh = new Date(AT.getTime() - HOUR);
  await queueOutboxRow({ key: "old-failed", status: "failed", createdAt: old });
  await queueOutboxRow({ key: "old-pending", status: "pending", createdAt: new Date(old.getTime() + HOUR) });
  await queueOutboxRow({ key: "old-sent", status: "sent", createdAt: old });
  await queueOutboxRow({ key: "fresh-failed", status: "failed", createdAt: fresh });

  const report = await readHealth(AT);
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.outbox, { ok: false, stuck: 2, oldestHours: 29 });
  assert.ok(!JSON.stringify(report).includes("example.com"), "the report never names a recipient");
});

test("the database ping succeeds against a live database", async () => {
  await pingDatabase();
});

test("a sweep outside production records its heartbeat without a monitor check-in", async () => {
  setEnv("VERCEL_ENV", "preview");
  await seedLoop();
  const report = await runSweep(AT);
  assert.equal(report.opened, 1);
  assert.equal(sentryCalls.monitors.length, 0);
  const [beat] = await rows<{ last_ok_at: Date }>("select last_ok_at from heartbeats where name = 'sweep'");
  assert.equal(new Date(beat.last_ok_at).toISOString(), AT.toISOString());
});

test("a sweep that finds another one running records no heartbeat", async () => {
  setEnv("VERCEL_ENV", "preview");
  await seedLoop();
  const { db } = await import("../../src/db/index.ts");
  const { sql } = await import("drizzle-orm");

  // Hold the sweep lock the way a concurrent (possibly stuck) trigger would.
  const report = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7311002)`);
    return runSweep(AT);
  });
  assert.equal(report.busy, true);
  assert.equal((await rows("select * from heartbeats")).length, 0);

  // Once the lock is free, the run that does the work records it.
  assert.equal((await runSweep(AT)).busy, false);
  assert.equal((await rows("select * from heartbeats")).length, 1);
});

test("a production sweep checks in to the Sentry cron monitor", async () => {
  setEnv("VERCEL_ENV", "production");
  await runSweep(AT);
  assert.equal(sentryCalls.monitors.length, 1);
  assert.equal(sentryCalls.monitors[0].slug, SWEEP_MONITOR_SLUG);
  assert.equal(sentryCalls.monitors[0].config, SWEEP_MONITOR_CONFIG);
  assert.equal(sentryCalls.monitors[0].status, "ok");
});

test("a failing sweep is reported, fails the check-in, and records no heartbeat", async () => {
  setEnv("VERCEL_ENV", "production");
  await rows("alter table heartbeats rename to heartbeats_away");
  try {
    await assert.rejects(runSweep(AT));
  } finally {
    await rows("alter table heartbeats_away rename to heartbeats");
  }
  assert.equal(sentryCalls.monitors[0].status, "error");
  assert.equal(sentryCalls.exceptions.length, 1);
  assert.equal(sentryCalls.exceptions[0].hint.extra.message, "Sweep failed");
  assert.equal((await rows("select * from heartbeats")).length, 0);
});

test("the logger writes one JSON line per event and reports errors to Sentry", (t) => {
  const lines: Array<[string, string]> = [];
  for (const method of ["log", "warn", "error"] as const) {
    t.mock.method(console, method, (line: string) => lines.push([method, line]));
  }

  log.info("Started", { route: "sweep" });
  log.warn("Slow");
  log.error("Unable to store image", new TypeError("disk full"), { issueId: "i1" });
  log.error("Odd value", "not an error");
  log.error("No cause");

  assert.deepEqual(JSON.parse(lines[0][1]), { level: "info", message: "Started", route: "sweep" });
  assert.equal(lines[1][0], "warn");
  assert.deepEqual(JSON.parse(lines[2][1]), {
    level: "error",
    message: "Unable to store image",
    issueId: "i1",
    error: { name: "TypeError", message: "disk full" },
  });
  assert.deepEqual(JSON.parse(lines[3][1]).error, { name: "string", message: "not an error" });
  assert.equal(JSON.parse(lines[4][1]).error, undefined);

  assert.equal(sentryCalls.exceptions.length, 3);
  assert.equal(sentryCalls.exceptions[0].error.message, "disk full");
  assert.deepEqual(sentryCalls.exceptions[0].hint.extra, { message: "Unable to store image", issueId: "i1" });
  assert.equal(sentryCalls.exceptions[1].error, "not an error");
  assert.equal(sentryCalls.exceptions[2].error.message, "No cause");
});

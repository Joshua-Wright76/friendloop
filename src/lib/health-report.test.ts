import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateHealth, OUTBOX_STUCK_AFTER_MS, SWEEP_STALE_AFTER_MS } from "./health-report.ts";

const AT = new Date("2026-11-03T12:00:00Z");
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(AT.getTime() - ms);

test("a recent sweep and an empty backlog is healthy", () => {
  const report = evaluateHealth({ at: AT, lastSweepAt: ago(6 * HOUR), stuckEmails: 0, oldestStuckAt: null });
  assert.deepEqual(report, {
    ok: true,
    at: AT.toISOString(),
    checks: {
      sweep: { ok: true, lastOkAt: ago(6 * HOUR).toISOString(), hoursSince: 6 },
      outbox: { ok: true, stuck: 0, oldestHours: null },
    },
  });
});

test("a sweep exactly at the threshold is still fine; a minute later it is stale", () => {
  assert.equal(
    evaluateHealth({ at: AT, lastSweepAt: ago(SWEEP_STALE_AFTER_MS), stuckEmails: 0, oldestStuckAt: null }).ok,
    true,
  );
  const stale = evaluateHealth({
    at: AT,
    lastSweepAt: ago(SWEEP_STALE_AFTER_MS + 60_000),
    stuckEmails: 0,
    oldestStuckAt: null,
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.checks.sweep.ok, false);
  assert.equal(stale.checks.sweep.hoursSince, 26);
});

test("a sweep that never recorded a run is unhealthy", () => {
  const report = evaluateHealth({ at: AT, lastSweepAt: null, stuckEmails: 0, oldestStuckAt: null });
  assert.equal(report.ok, false);
  assert.deepEqual(report.checks.sweep, { ok: false, lastOkAt: null, hoursSince: null });
});

test("stuck mail is unhealthy and reports how old the oldest row is", () => {
  const report = evaluateHealth({
    at: AT,
    lastSweepAt: ago(HOUR),
    stuckEmails: 3,
    oldestStuckAt: ago(OUTBOX_STUCK_AFTER_MS + 4 * HOUR),
  });
  assert.equal(report.ok, false);
  assert.equal(report.checks.sweep.ok, true);
  assert.deepEqual(report.checks.outbox, { ok: false, stuck: 3, oldestHours: 30 });
});

/**
 * The sweep as the cron endpoint runs it: wrapped in a Sentry cron check-in,
 * recorded as a heartbeat when it finishes, and reported when it throws.
 *
 * Kept outside `sweep.ts` so the reconciliation logic stays about the loops,
 * and so the monitor and heartbeat see exactly what the endpoint did.
 */
import * as Sentry from "@sentry/nextjs";
import { sweep, type SweepReport } from "./sweep";
import { recordHeartbeat, SWEEP_HEARTBEAT } from "./health";
import { log } from "./log";

/** Sentry's cron monitor slug; the monitor is created on the first check-in. */
export const SWEEP_MONITOR_SLUG = "cron-sweep";

/** Mirrors `vercel.json`. Vercel Hobby fires anywhere in the hour, hence the margin. */
export const SWEEP_MONITOR_CONFIG = {
  schedule: { type: "crontab", value: "0 6 * * *" },
  timezone: "UTC",
  checkinMargin: 60,
  maxRuntime: 15,
  failureIssueThreshold: 1,
  recoveryThreshold: 1,
} as const;

async function sweepAndRecord(at: Date): Promise<SweepReport> {
  try {
    const report = await sweep({ at });
    // A busy run did no work: another sweep holds the lock. Only that run's
    // success may refresh the heartbeat, so a lock holder that hangs or dies
    // still lets /api/health go stale instead of being masked by busy no-ops.
    if (!report.busy) await recordHeartbeat(SWEEP_HEARTBEAT, at);
    return report;
  } catch (error) {
    log.error("Sweep failed", error, { at: at.toISOString() });
    throw error;
  }
}

export async function runSweep(at: Date): Promise<SweepReport> {
  // Only production has a schedule to miss. A manual sweep on a preview would
  // otherwise create check-ins that Sentry then expects every day.
  if (process.env.VERCEL_ENV !== "production") return sweepAndRecord(at);
  return Sentry.withMonitor(SWEEP_MONITOR_SLUG, () => sweepAndRecord(at), SWEEP_MONITOR_CONFIG);
}

/**
 * The pure half of the health check: given what the database said, is the
 * instance healthy? Kept free of imports so it unit tests without a database.
 */

const HOUR = 60 * 60 * 1000;

/**
 * A Vercel Schedule runs the sweep every 15 minutes, up to 15 minutes late. Two
 * hours without one means the schedule has stopped (it is in beta, and skips runs
 * past the Hobby monthly limit), and the fallback in sweep.yml can leave
 * prompts hours late, which is worth hearing about.
 */
export const SWEEP_STALE_AFTER_MS = 2 * HOUR;

/**
 * A row still unsent after this long has already been through at least one
 * retrying sweep and failed again — a provider or configuration problem, not a
 * blip.
 */
export const OUTBOX_STUCK_AFTER_MS = 26 * HOUR;

export const SWEEP_HEARTBEAT = "sweep";

export type HealthInput = {
  at: Date;
  lastSweepAt: Date | null;
  stuckEmails: number;
  oldestStuckAt: Date | null;
};

export type HealthReport = {
  ok: boolean;
  at: string;
  checks: {
    sweep: { ok: boolean; lastOkAt: string | null; hoursSince: number | null };
    outbox: { ok: boolean; stuck: number; oldestHours: number | null };
  };
};

function hoursBetween(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / HOUR) * 10) / 10;
}

/** Pure: decide health from what the database said. Counts and ages only — no addresses. */
export function evaluateHealth(input: HealthInput): HealthReport {
  const { at, lastSweepAt, stuckEmails, oldestStuckAt } = input;
  const sweepOk = lastSweepAt !== null && at.getTime() - lastSweepAt.getTime() <= SWEEP_STALE_AFTER_MS;
  const outboxOk = stuckEmails === 0;
  return {
    ok: sweepOk && outboxOk,
    at: at.toISOString(),
    checks: {
      sweep: {
        ok: sweepOk,
        lastOkAt: lastSweepAt?.toISOString() ?? null,
        hoursSince: lastSweepAt ? hoursBetween(lastSweepAt, at) : null,
      },
      outbox: {
        ok: outboxOk,
        stuck: stuckEmails,
        oldestHours: oldestStuckAt ? hoursBetween(oldestStuckAt, at) : null,
      },
    },
  };
}

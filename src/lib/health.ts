/**
 * Is the instance doing its job when nobody is looking?
 *
 * The sweep self-heals whenever it runs, and the outbox retries whatever the
 * provider rejected — so the two failures worth paging on are the sweep not
 * running at all, and mail that stays unsent across retries. Both are checked
 * here; `/api/health` serves the result and a GitHub schedule probes it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { heartbeats, outbox } from "@/db/schema";
import { evaluateHealth, OUTBOX_STUCK_AFTER_MS, SWEEP_HEARTBEAT, type HealthReport } from "./health-report.ts";

export { SWEEP_HEARTBEAT };

/** Called after a sweep finishes without throwing. */
export async function recordHeartbeat(name: string, at: Date): Promise<void> {
  await db
    .insert(heartbeats)
    .values({ name, lastOkAt: at })
    .onConflictDoUpdate({ target: heartbeats.name, set: { lastOkAt: at } });
}

export async function readHealth(at: Date): Promise<HealthReport> {
  const [beat] = await db
    .select({ lastOkAt: heartbeats.lastOkAt })
    .from(heartbeats)
    .where(eq(heartbeats.name, SWEEP_HEARTBEAT))
    .limit(1);

  const cutoff = new Date(at.getTime() - OUTBOX_STUCK_AFTER_MS);
  const [stuck] = await db
    .select({
      count: sql<number>`count(*)::int`,
      oldest: sql<string | null>`min(${outbox.createdAt})`,
    })
    .from(outbox)
    .where(
      and(inArray(outbox.status, ["pending", "failed"]), sql`${outbox.createdAt} < ${cutoff.toISOString()}`),
    );

  return evaluateHealth({
    at,
    lastSweepAt: beat?.lastOkAt ?? null,
    stuckEmails: stuck.count,
    oldestStuckAt: stuck.oldest ? new Date(stuck.oldest) : null,
  });
}

/** The cheap public liveness check: can this deployment reach its database? */
export async function pingDatabase(): Promise<void> {
  await db.execute(sql`select 1`);
}

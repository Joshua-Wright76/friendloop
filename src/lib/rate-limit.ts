import { lte, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";
import { getNow } from "./clock";
import type { Limit } from "./rate-limit-policy";

export { LIMITS, limitKey, type Limit } from "./rate-limit-policy";

export type LimitResult = { allowed: boolean; count: number; resetAt: Date };

/**
 * Count one attempt against `key` and say whether it is still inside `limit`.
 *
 * One upsert: a new window starts at 1, the same window adds 1. Postgres
 * serialises the conflicting rows, so two requests at once can never both read
 * the same count. A refused attempt still counts, so hammering never earns a slot.
 */
export async function consume(key: string, limit: Limit, at?: Date): Promise<LimitResult> {
  const now = at ?? (await getNow());
  const windowStart = new Date(Math.floor(now.getTime() / limit.windowMs) * limit.windowMs);
  const resetAt = new Date(windowStart.getTime() + limit.windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1, expiresAt: resetAt })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when rate_limits.window_start = excluded.window_start then rate_limits.count + 1 else 1 end`,
        windowStart: sql`excluded.window_start`,
        expiresAt: sql`excluded.expires_at`,
      },
    })
    .returning({ count: rateLimits.count });

  return { allowed: row.count <= limit.max, count: row.count, resetAt };
}

/** Drop every counter whose window has closed. Called by the sweep. */
export async function pruneRateLimits(at: Date): Promise<number> {
  const deleted = await db
    .delete(rateLimits)
    .where(lte(rateLimits.expiresAt, at))
    .returning({ key: rateLimits.key });
  return deleted.length;
}

/**
 * The caller's address as Vercel reports it. Vercel overwrites both headers at
 * its edge, so a client cannot choose its own bucket there; anywhere else they
 * are only as trustworthy as the proxy in front.
 */
export function clientIp(requestHeaders: Headers): string {
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  const real = requestHeaders.get("x-real-ip")?.trim();
  return real || "unknown";
}

/** `clientIp` for code that has no `Request` in hand (server actions). */
export async function requestIp(): Promise<string> {
  try {
    return clientIp(await headers());
  } catch {
    return "unknown";
  }
}

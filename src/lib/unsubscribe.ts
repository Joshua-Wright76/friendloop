import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { groups, memberships } from "@/db/schema";
import { getNow } from "./clock.ts";

/** Unsubscribe tokens are 64 lowercase hex characters; anything else is not one. */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export type UnsubscribeContext =
  | { state: "invalid" }
  | {
      state: "ok";
      membershipId: string;
      muted: boolean;
      groupName: string;
      group: Pick<typeof groups.$inferSelect, "themePreset" | "themeAccent">;
    };

/**
 * Who an unsubscribe link belongs to. The token only ever answers "which loop,
 * and is it muted": it is not a reply credential, so nothing else is returned.
 * A removed member's link reads as invalid — the loop no longer mails them.
 */
export async function resolveUnsubscribe(token: string): Promise<UnsubscribeContext> {
  if (!TOKEN_SHAPE.test(token)) return { state: "invalid" };
  const [row] = await db
    .select({
      membershipId: memberships.id,
      mutedAt: memberships.mutedAt,
      groupName: groups.name,
      themePreset: groups.themePreset,
      themeAccent: groups.themeAccent,
    })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.unsubscribeToken, token), isNull(memberships.revokedAt)))
    .limit(1);
  if (!row) return { state: "invalid" };
  return {
    state: "ok",
    membershipId: row.membershipId,
    muted: row.mutedAt !== null,
    groupName: row.groupName,
    group: { themePreset: row.themePreset, themeAccent: row.themeAccent },
  };
}

/**
 * Mute or unmute the membership behind an unsubscribe token. Idempotent: muting
 * twice keeps the first `muted_at`, so the record says when they first asked.
 */
export async function setMutedByToken(token: string, muted: boolean): Promise<boolean> {
  const context = await resolveUnsubscribe(token);
  if (context.state !== "ok") return false;
  if (muted) {
    const at = await getNow();
    await db
      .update(memberships)
      .set({ mutedAt: at })
      .where(and(eq(memberships.id, context.membershipId), isNull(memberships.mutedAt)));
  } else {
    await db.update(memberships).set({ mutedAt: null }).where(eq(memberships.id, context.membershipId));
  }
  return true;
}

/**
 * Where a confirm form may send someone back to: a path on this site, never a
 * scheme-relative `//host` or an absolute URL.
 */
export function safeBackPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  return value;
}

import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { reactions, replies } from "@/db/schema";
import { MAX_REACTIONS_PER_PERSON, isReactionEmoji } from "./reaction-emoji.ts";
import { legacyReplyCondition } from "./legacy-ask";

export type ReactionResult = { ok: true } | { ok: false; reason: "emoji" | "answer" | "limit" };

/**
 * Add this person's reaction to an answer, or take it back if it's already there.
 * Any emoji is welcome; the checks are only that it is one, and that the answer
 * belongs to the round the viewer was let into.
 */
export async function toggleReactionFor(input: {
  issueId: string;
  replyId: string;
  membershipId: string;
  emoji: string;
}): Promise<ReactionResult> {
  if (!isReactionEmoji(input.emoji)) return { ok: false, reason: "emoji" };

  const [reply] = await db
    .select({ id: replies.id })
    .from(replies)
    .where(and(eq(replies.id, input.replyId), eq(replies.issueId, input.issueId), legacyReplyCondition()))
    .limit(1);
  if (!reply) return { ok: false, reason: "answer" };

  const mineHere = and(eq(reactions.replyId, input.replyId), eq(reactions.membershipId, input.membershipId));
  const [existing] = await db
    .select({ id: reactions.id })
    .from(reactions)
    .where(and(mineHere, eq(reactions.emoji, input.emoji)))
    .limit(1);
  if (existing) {
    await db.delete(reactions).where(eq(reactions.id, existing.id));
    return { ok: true };
  }

  const [{ used }] = await db.select({ used: count() }).from(reactions).where(mineHere);
  if (used >= MAX_REACTIONS_PER_PERSON) return { ok: false, reason: "limit" };

  await db
    .insert(reactions)
    .values({ replyId: input.replyId, membershipId: input.membershipId, emoji: input.emoji })
    .onConflictDoNothing();
  return { ok: true };
}

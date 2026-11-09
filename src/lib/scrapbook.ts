import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { issueQuestions, issueStickers, issues, memberships, replies } from "@/db/schema";
import { replyHasContentCondition } from "./reply-query";
import { consume, LIMITS, limitKey } from "./rate-limit";
import { SCRAPBOOK_PER_ROUND, cleanPlacement, isStickerKey, type StickerPlacement } from "./looks.ts";

/**
 * The scrapbook layer: stickers people stick in an answer's margins once its round
 * has gone out. Anyone still in the loop who can read the answer may stick a few
 * (`SCRAPBOOK_PER_ROUND` each, across the round), move their own and peel them off;
 * the owner and admins may peel off anyone's. Nothing here sends an email.
 */

export type ScrapRow = { id: string; replyId: string; sticker: string } & StickerPlacement;
export type ScrapRefusal = "round" | "answer" | "sticker" | "placement" | "limit" | "busy" | "gone";
export type ScrapResult = { ok: true; sticker: ScrapRow } | { ok: false; reason: ScrapRefusal };

const columns = {
  id: issueStickers.id,
  replyId: issueStickers.replyId,
  sticker: issueStickers.sticker,
  side: issueStickers.side,
  offset: issueStickers.offset,
  tilt: issueStickers.tilt,
};

const asRow = (row: { id: string; replyId: string; sticker: string; side: string; offset: number; tilt: number }): ScrapRow => ({
  ...row,
  side: row.side === "right" ? "right" : "left",
});

/** The viewer's standing in the round's loop, and whether the round has gone out. Null for anyone not in it. */
async function standing(issueId: string, membershipId: string) {
  const [row] = await db
    .select({ status: issues.status, access: memberships.access })
    .from(issues)
    .innerJoin(memberships, and(eq(memberships.groupId, issues.groupId), eq(memberships.id, membershipId), isNull(memberships.revokedAt)))
    .where(eq(issues.id, issueId))
    .limit(1);
  return row ?? null;
}

/** One attempt against the member's fidget allowance. */
async function allowed(membershipId: string): Promise<boolean> {
  return (await consume(limitKey.scrapbook(membershipId), LIMITS.scrapbook)).allowed;
}

/**
 * Stick a sticker beside one answer. The round must have gone out, the answer must
 * be in it with something written, and the viewer must be able to read it (an
 * owners-only answer takes stickers from owners and admins only). The count and the
 * insert share one lock per person and round, so two taps at once can't make four.
 */
export async function stickOnAnswer(input: {
  issueId: string;
  replyId: string;
  membershipId: string;
  sticker: unknown;
  placement: unknown;
}): Promise<ScrapResult> {
  if (!isStickerKey(input.sticker)) return { ok: false, reason: "sticker" };
  const sticker = input.sticker;
  const placement = cleanPlacement(input.placement);
  if (!placement) return { ok: false, reason: "placement" };

  const viewer = await standing(input.issueId, input.membershipId);
  if (!viewer || viewer.status !== "delivered") return { ok: false, reason: "round" };
  const [reply] = await db
    .select({ adminOnly: issueQuestions.adminOnly })
    .from(replies)
    .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
    .where(and(eq(replies.id, input.replyId), eq(replies.issueId, input.issueId), replyHasContentCondition()))
    .limit(1);
  if (!reply || (reply.adminOnly && viewer.access === "member")) return { ok: false, reason: "answer" };
  if (!(await allowed(input.membershipId))) return { ok: false, reason: "busy" };

  return db.transaction(async (tx): Promise<ScrapResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`scrapbook:${input.issueId}:${input.membershipId}`}, 0))`);
    const mine = and(eq(issueStickers.issueId, input.issueId), eq(issueStickers.membershipId, input.membershipId));
    const [{ used }] = await tx.select({ used: count() }).from(issueStickers).where(mine);
    if (used >= SCRAPBOOK_PER_ROUND) return { ok: false, reason: "limit" };
    const [row] = await tx
      .insert(issueStickers)
      .values({ issueId: input.issueId, replyId: input.replyId, membershipId: input.membershipId, sticker, ...placement })
      .returning(columns);
    return { ok: true, sticker: asRow(row) };
  });
}

/** Move one of your own stickers along or across its answer's margins. */
export async function moveScrapSticker(input: {
  issueId: string;
  stickerId: string;
  membershipId: string;
  placement: unknown;
}): Promise<ScrapResult> {
  const placement = cleanPlacement(input.placement);
  if (!placement) return { ok: false, reason: "placement" };
  const viewer = await standing(input.issueId, input.membershipId);
  if (!viewer || viewer.status !== "delivered") return { ok: false, reason: "round" };
  if (!(await allowed(input.membershipId))) return { ok: false, reason: "busy" };

  const [row] = await db
    .update(issueStickers)
    .set(placement)
    .where(and(eq(issueStickers.id, input.stickerId), eq(issueStickers.issueId, input.issueId), eq(issueStickers.membershipId, input.membershipId)))
    .returning(columns);
  return row ? { ok: true, sticker: asRow(row) } : { ok: false, reason: "gone" };
}

/** Peel a sticker off: your own, or, for the owner and admins, anyone's. */
export async function peelScrapSticker(input: {
  issueId: string;
  stickerId: string;
  membershipId: string;
}): Promise<ScrapResult> {
  const viewer = await standing(input.issueId, input.membershipId);
  if (!viewer || viewer.status !== "delivered") return { ok: false, reason: "round" };
  if (!(await allowed(input.membershipId))) return { ok: false, reason: "busy" };

  const moderator = viewer.access === "owner" || viewer.access === "admin";
  const [row] = await db
    .delete(issueStickers)
    .where(and(
      eq(issueStickers.id, input.stickerId),
      eq(issueStickers.issueId, input.issueId),
      moderator ? undefined : eq(issueStickers.membershipId, input.membershipId),
    ))
    .returning(columns);
  return row ? { ok: true, sticker: asRow(row) } : { ok: false, reason: "gone" };
}

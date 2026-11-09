"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { membershipForViewer } from "@/lib/issue-view";
import { currentUser } from "@/lib/auth";
import { copy, text } from "@/lib/copy";
import { toggleReactionFor } from "@/lib/reactions";
import { moveScrapSticker, peelScrapSticker, stickOnAnswer, type ScrapRefusal, type ScrapRow } from "@/lib/scrapbook";
import { SCRAPBOOK_PER_ROUND } from "@/lib/looks";

export type ActionResult = { ok: boolean; error?: string };

/**
 * Who is acting: the `?m=` token from a delivery email, or the signed-in member
 * reading the archive. The page accepts both, so the write path has to as well —
 * otherwise a signed-in member gets a comment box that silently refuses.
 */
async function viewerFor(issueId: string, viewerToken: string | null) {
  const [issue] = await db
    .select({ groupId: issues.groupId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!issue) return null;

  const user = await currentUser();
  return membershipForViewer({
    groupId: issue.groupId,
    userId: user?.id ?? null,
    token: viewerToken,
  });
}

export async function toggleReaction(input: {
  issueId: string;
  replyId: string;
  emoji: string;
  viewerToken: string | null;
}): Promise<ActionResult> {
  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: copy.issue.errors.reactMembersOnly };

  const result = await toggleReactionFor({
    issueId: input.issueId,
    replyId: input.replyId,
    membershipId: membership.id,
    emoji: input.emoji,
  });
  if (!result.ok) {
    return { ok: false, error: result.reason === "limit" ? copy.issue.errors.reactLimit : copy.issue.errors.reactRefused };
  }

  revalidatePath(`/i/${input.issueId}`);
  return { ok: true };
}

/* ------------------------------- scrapbook ------------------------------- */

export type ScrapActionResult =
  | { ok: true; sticker: ScrapRow }
  | { ok: false; error: string };

const scrapErrors = copy.issue.scrapbook.errors;

function scrapRefused(reason: ScrapRefusal): ScrapActionResult {
  const messages: Record<ScrapRefusal, string> = {
    round: scrapErrors.round,
    answer: scrapErrors.answer,
    sticker: scrapErrors.sticker,
    placement: scrapErrors.failed,
    limit: text(scrapErrors.limit, { limit: SCRAPBOOK_PER_ROUND }),
    busy: scrapErrors.busy,
    gone: scrapErrors.gone,
  };
  return { ok: false, error: messages[reason] };
}

/** Stick a sticker in an answer's margin, once its round has gone out. */
export async function stickScrapSticker(input: {
  issueId: string;
  replyId: string;
  sticker: string;
  placement: { side: string; offset: number; tilt: number };
  viewerToken: string | null;
}): Promise<ScrapActionResult> {
  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: scrapErrors.membersOnly };
  const result = await stickOnAnswer({ issueId: input.issueId, replyId: input.replyId, membershipId: membership.id, sticker: input.sticker, placement: input.placement });
  return result.ok ? result : scrapRefused(result.reason);
}

/** Move one of your own stickers along or across the margins. */
export async function moveScrapStickerAction(input: {
  issueId: string;
  stickerId: string;
  placement: { side: string; offset: number; tilt: number };
  viewerToken: string | null;
}): Promise<ScrapActionResult> {
  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: scrapErrors.membersOnly };
  const result = await moveScrapSticker({ issueId: input.issueId, stickerId: input.stickerId, membershipId: membership.id, placement: input.placement });
  return result.ok ? result : scrapRefused(result.reason);
}

/** Peel a sticker off: your own, or anyone's for the owner and admins. */
export async function peelScrapStickerAction(input: {
  issueId: string;
  stickerId: string;
  viewerToken: string | null;
}): Promise<ScrapActionResult> {
  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: scrapErrors.membersOnly };
  const result = await peelScrapSticker({ issueId: input.issueId, stickerId: input.stickerId, membershipId: membership.id });
  return result.ok ? result : scrapRefused(result.reason);
}

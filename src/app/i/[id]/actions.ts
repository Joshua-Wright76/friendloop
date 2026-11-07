"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { issues } from "@/db/schema";
import { membershipForViewer } from "@/lib/issue-view";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { toggleReactionFor } from "@/lib/reactions";

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

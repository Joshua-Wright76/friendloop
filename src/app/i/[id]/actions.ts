"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { comments, issues, reactions } from "@/db/schema";
import { membershipForViewer } from "@/lib/issue-view";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";

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

export async function addComment(input: {
  issueId: string;
  body: string;
  viewerToken: string | null;
}): Promise<ActionResult> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: copy.issue.writeFirst };
  if (body.length > 2000) return { ok: false, error: copy.issue.errors.tooLong };

  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: copy.issue.errors.commentMembersOnly };

  await db.insert(comments).values({
    issueId: input.issueId,
    membershipId: membership.id,
    body,
  });

  revalidatePath(`/i/${input.issueId}`);
  return { ok: true };
}

export async function toggleReaction(input: {
  issueId: string;
  replyId: string;
  emoji: string;
  viewerToken: string | null;
}): Promise<ActionResult> {
  const membership = await viewerFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: copy.issue.errors.reactMembersOnly };

  const [existing] = await db
    .select()
    .from(reactions)
    .where(
      and(
        eq(reactions.replyId, input.replyId),
        eq(reactions.membershipId, membership.id),
        eq(reactions.emoji, input.emoji),
      ),
    )
    .limit(1);

  if (existing) {
    await db.delete(reactions).where(eq(reactions.id, existing.id));
  } else {
    await db.insert(reactions).values({
      replyId: input.replyId,
      membershipId: membership.id,
      emoji: input.emoji,
    });
  }

  revalidatePath(`/i/${input.issueId}`);
  return { ok: true };
}

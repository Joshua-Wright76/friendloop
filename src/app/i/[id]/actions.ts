"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { comments, issuePicks, issues, reactions, replies } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { isIssueTheme } from "@/lib/issue-experience";
import { membershipForViewer, reactionChoices } from "@/lib/issue-view";

export type ActionResult = { ok: boolean; error?: string };

async function viewerFor(issueId: string, viewerToken: string | null) {
  const [issue] = await db
    .select({ groupId: issues.groupId })
    .from(issues)
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!issue) return null;
  const user = await currentUser();
  return membershipForViewer({ groupId: issue.groupId, userId: user?.id ?? null, token: viewerToken });
}

async function editorFor(issueId: string, viewerToken: string | null) {
  const membership = await viewerFor(issueId, viewerToken);
  return membership && (membership.access === "owner" || membership.access === "admin")
    ? membership
    : null;
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
  if (!reactionChoices().includes(input.emoji)) {
    return { ok: false, error: copy.issue.errors.invalidReaction };
  }

  const [answer] = await db
    .select({ id: replies.id })
    .from(replies)
    .where(and(
      eq(replies.id, input.replyId),
      eq(replies.issueId, input.issueId),
      eq(replies.status, "submitted"),
    ))
    .limit(1);
  if (!answer) return { ok: false, error: copy.issue.errors.replyUnavailable };

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

export async function toggleIssuePick(input: {
  issueId: string;
  replyId: string;
  viewerToken: string | null;
}): Promise<ActionResult> {
  const membership = await editorFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: copy.issue.errors.editorsOnly };

  const [answer] = await db
    .select({ id: replies.id })
    .from(replies)
    .where(and(
      eq(replies.id, input.replyId),
      eq(replies.issueId, input.issueId),
      eq(replies.status, "submitted"),
    ))
    .limit(1);
  if (!answer) return { ok: false, error: copy.issue.errors.pickUnavailable };

  const [existing] = await db
    .select({ id: issuePicks.id })
    .from(issuePicks)
    .where(and(eq(issuePicks.issueId, input.issueId), eq(issuePicks.replyId, input.replyId)))
    .limit(1);
  if (existing) {
    await db.delete(issuePicks).where(eq(issuePicks.id, existing.id));
  } else {
    await db.insert(issuePicks).values({
      issueId: input.issueId,
      replyId: input.replyId,
      createdByMembershipId: membership.id,
    });
  }

  revalidatePath(`/i/${input.issueId}`);
  return { ok: true };
}

export async function setIssueTheme(input: {
  issueId: string;
  theme: string | null;
  viewerToken: string | null;
}): Promise<ActionResult> {
  const membership = await editorFor(input.issueId, input.viewerToken);
  if (!membership) return { ok: false, error: copy.issue.errors.editorsOnly };
  if (input.theme !== null && !isIssueTheme(input.theme)) {
    return { ok: false, error: copy.issue.errors.invalidTheme };
  }

  await db.update(issues).set({ theme: input.theme }).where(eq(issues.id, input.issueId));
  revalidatePath(`/i/${input.issueId}`);
  return { ok: true };
}

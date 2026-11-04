import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { comments, groups, issueQuestions, issues, memberships, replies } from "@/db/schema";
import { currentUser } from "./auth";
import { copy } from "./copy.ts";
import { displayName } from "./comment-view.ts";
import { sendEmail } from "./email/send";
import { emailThemeOf, mentionEmail } from "./email/templates";
import { excerpt, isUuid, markMentions, mentionIds, plainBody, type MentionPick } from "./mentions.ts";
import { membershipForViewer } from "./issue-view";
import { deleteStoredPhoto, storePhoto } from "./photo-storage";
import { validatePhoto } from "./photo-validation";
import { issueUrl } from "./urls";
import { consume, LIMITS } from "./rate-limit";
import { log } from "./log";

export const COMMENT_MAX_LENGTH = 2000;
/** How much of a comment a mention email carries. */
export const MENTION_EXCERPT = 240;

export type PostCommentResult =
  | { ok: true; id: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 500; error: string };

export type PostCommentInput = {
  issueId: string;
  /** The `?m=` token from a delivery link; a signed-in member needs none. */
  viewerToken: string | null;
  /** Chosen by the composer, so a retried or doubled request is the same comment. */
  id?: string;
  body: string;
  /** Hang the comment from one answer instead of the issue-level thread. */
  replyId?: string | null;
  quoteCommentId?: string | null;
  mentions?: MentionPick[];
  photo?: { bytes: Uint8Array; type?: string } | null;
};

function fail(status: Extract<PostCommentResult, { ok: false }>["status"], error: string): PostCommentResult {
  return { ok: false, status, error };
}

/**
 * Write one comment, and tell the people it mentions.
 *
 * Everything that can refuse does so before anything is stored: the author must be
 * a live member, comments must be on, and an answer or quote must really belong to
 * this issue. The email dedupe key carries the comment id, so sending the same
 * request twice is one comment and one email.
 */
export async function postComment(input: PostCommentInput): Promise<PostCommentResult> {
  const body = input.body.trim();
  if (!body && !input.photo) return fail(400, copy.issue.writeFirst);
  if (body.length > COMMENT_MAX_LENGTH) return fail(400, copy.issue.errors.tooLong);
  if (input.id !== undefined && !isUuid(input.id)) return fail(400, copy.issue.errors.invalidRequest);
  if (input.replyId && !isUuid(input.replyId)) return fail(404, copy.issue.errors.answerGone);
  if (input.quoteCommentId && !isUuid(input.quoteCommentId)) return fail(409, copy.issue.errors.quoteGone);
  if (!isUuid(input.issueId)) return fail(404, copy.issue.errors.invalidRequest);

  const [row] = await db
    .select({ issue: issues, group: groups })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(eq(issues.id, input.issueId))
    .limit(1);
  if (!row) return fail(404, copy.issue.errors.invalidRequest);
  const { issue, group } = row;

  const user = await currentUser();
  const author = await membershipForViewer({
    groupId: group.id,
    userId: user?.id ?? null,
    token: input.viewerToken,
  });
  if (!author) return fail(403, copy.issue.errors.commentMembersOnly);
  if (!group.commentsEnabled) return fail(403, copy.issue.errors.commentsOff);
  // Per member, whichever way they arrived (session or `?m=` token).
  if (!(await consume(`comment:member:${author.id}`, LIMITS.comment)).allowed) {
    return fail(429, copy.issue.errors.tooMany);
  }

  if (input.replyId) {
    const [answer] = await db
      .select({ membershipId: replies.membershipId, kind: issueQuestions.kind })
      .from(replies)
      .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
      .where(
        and(eq(replies.id, input.replyId), eq(replies.issueId, issue.id), eq(replies.status, "submitted")),
      )
      .limit(1);
    // Nobody sees another person's poll pick until the round is delivered, so
    // there is nothing for them to comment on yet.
    const hidden = answer?.kind === "poll" && issue.status !== "delivered" && answer.membershipId !== author.id;
    if (!answer || hidden) return fail(404, copy.issue.errors.answerGone);
  }

  if (input.quoteCommentId) {
    const [quoted] = await db
      .select({ id: comments.id })
      .from(comments)
      .where(
        and(
          eq(comments.id, input.quoteCommentId),
          eq(comments.issueId, issue.id),
          isNull(comments.deletedAt),
          input.replyId ? eq(comments.replyId, input.replyId) : isNull(comments.replyId),
        ),
      )
      .limit(1);
    if (!quoted) return fail(409, copy.issue.errors.quoteGone);
  }

  // Only live members, and never the author: mentioning yourself is just a name.
  const wanted = (input.mentions ?? []).filter((pick) => isUuid(pick.id) && pick.id !== author.id);
  const mentionable = wanted.length
    ? await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.groupId, group.id),
            isNull(memberships.revokedAt),
            inArray(memberships.id, wanted.map((pick) => pick.id)),
          ),
        )
    : [];
  const allowed = new Set(mentionable.map((member) => member.id));
  const marked = markMentions(body, wanted.filter((pick) => allowed.has(pick.id)));

  let photoUrl: string | null = null;
  if (input.photo) {
    const checked = validatePhoto(input.photo.bytes, input.photo.type);
    if (!checked.ok) {
      return checked.reason === "too-large"
        ? fail(413, copy.issue.errors.photoTooLarge)
        : fail(415, copy.issue.errors.photoInvalid);
    }
    try {
      photoUrl = await storePhoto(input.photo.bytes, checked.format);
    } catch (error) {
      log.error("Unable to store comment photo", error);
      return fail(500, copy.issue.errors.photoFailed);
    }
  }

  const [inserted] = await db
    .insert(comments)
    .values({
      ...(input.id ? { id: input.id } : {}),
      issueId: issue.id,
      membershipId: author.id,
      body: marked.body,
      replyId: input.replyId ?? null,
      quoteCommentId: input.quoteCommentId ?? null,
      photoUrl,
    })
    .onConflictDoNothing({ target: comments.id })
    .returning({ id: comments.id });

  let commentId = inserted?.id;
  let notify = marked.ids;
  if (!inserted) {
    // The same id again. If it is this author's comment on this issue it is a retry:
    // keep the first write, and let the mention dedupe keys make the emails safe to
    // attempt once more. Anyone else's id is not ours to touch.
    // The first attempt already stored its own copy; this one is surplus.
    if (photoUrl) await deleteStoredPhoto(photoUrl);
    const [existing] = await db
      .select({ membershipId: comments.membershipId, issueId: comments.issueId, body: comments.body })
      .from(comments)
      .where(eq(comments.id, input.id as string))
      .limit(1);
    if (!existing || existing.membershipId !== author.id || existing.issueId !== issue.id) {
      return fail(409, copy.issue.errors.invalidRequest);
    }
    commentId = input.id as string;
    notify = mentionIds(existing.body);
  }

  await notifyMentioned({
    commentId: commentId as string,
    issue,
    group,
    author,
    ids: notify,
  });

  return { ok: true, id: commentId as string };
}

/** One email per mentioned member, ever, for a given comment. */
async function notifyMentioned(input: {
  commentId: string;
  issue: typeof issues.$inferSelect;
  group: typeof groups.$inferSelect;
  author: typeof memberships.$inferSelect;
  ids: string[];
}): Promise<void> {
  const { commentId, issue, group, author, ids } = input;
  const recipients = ids.filter((id) => id !== author.id);
  if (recipients.length === 0) return;

  const [comment] = await db.select({ body: comments.body }).from(comments).where(eq(comments.id, commentId)).limit(1);
  const people = await db.select().from(memberships).where(eq(memberships.groupId, group.id));
  const names = new Map(people.map((person) => [person.id, displayName(person)]));
  const excerptText = excerpt(plainBody(comment.body, names, copy.issue.unknownMention), MENTION_EXCERPT);

  for (const person of people) {
    if (!recipients.includes(person.id) || person.revokedAt) continue;
    const rendered = mentionEmail({
      groupName: group.name,
      memberName: displayName(person),
      authorName: displayName(author),
      issueNumber: issue.number,
      issueName: issue.name,
      excerpt: excerptText,
      url: issueUrl(issue.id, person.replyToken),
      theme: emailThemeOf(group),
    });
    await sendEmail({
      ...rendered,
      to: person.email,
      kind: "mention",
      dedupeKey: `mention:${issue.id}:${commentId}:${person.id}`,
      groupId: group.id,
      issueId: issue.id,
      membershipId: person.id,
      fromName: group.displayName ?? group.name,
    });
  }
}

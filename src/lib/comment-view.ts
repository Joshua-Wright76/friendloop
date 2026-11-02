import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { comments, memberships } from "@/db/schema";
import { copy } from "./copy.ts";
import { bodyParts, excerpt, plainBody, type BodyPart } from "./mentions.ts";

export type IssueComment = {
  id: string;
  author: string;
  authorPhotoUrl: string | null;
  isYou: boolean;
  parts: BodyPart[];
  photoUrl: string | null;
  createdAt: Date;
  /** The comment this one answers; `removed` when that comment has since gone. */
  quote: { author: string; text: string; removed: boolean } | null;
};

export type CommentThreads = {
  /** The issue-level thread, oldest first. */
  top: IssueComment[];
  /** Threads hanging from a single answer, keyed by the reply they belong to. */
  byReply: Map<string, IssueComment[]>;
  /** Everyone a comment can mention, apart from the viewer. */
  mentionables: Array<{ id: string; name: string; photoUrl: string | null }>;
};

export const QUOTE_EXCERPT = 140;

/** How a person is shown: their name, or the front of their address until they give one. */
export function displayName(member: { name: string | null; email: string }): string {
  return member.name ?? member.email.split("@")[0];
}

/** Every live comment on an issue, grouped by where it hangs, with mentions and quotes resolved. */
export async function loadComments(input: {
  issueId: string;
  groupId: string;
  viewerMembershipId: string | null;
}): Promise<CommentThreads> {
  const { issueId, groupId, viewerMembershipId } = input;

  const people = await db
    .select({
      id: memberships.id,
      name: memberships.name,
      email: memberships.email,
      photoUrl: memberships.photoUrl,
      revokedAt: memberships.revokedAt,
    })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));
  const names = new Map(people.map((person) => [person.id, displayName(person)]));
  const photos = new Map(people.map((person) => [person.id, person.photoUrl]));

  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.issueId, issueId), isNull(comments.deletedAt)))
    .orderBy(asc(comments.createdAt), asc(comments.id));

  // A quote may point at a comment that has since been removed; look those up
  // separately so the quote can say so instead of silently vanishing.
  const quotedIds = [...new Set(rows.flatMap((row) => (row.quoteCommentId ? [row.quoteCommentId] : [])))];
  const quoted = quotedIds.length
    ? await db.select().from(comments).where(inArray(comments.id, quotedIds))
    : [];
  const quotedById = new Map(quoted.map((row) => [row.id, row]));

  const view = (row: (typeof rows)[number]): IssueComment => {
    const target = row.quoteCommentId ? quotedById.get(row.quoteCommentId) : undefined;
    const removed = Boolean(row.quoteCommentId) && (!target || target.deletedAt !== null);
    return {
      id: row.id,
      author: row.membershipId === viewerMembershipId ? copy.issue.you : (names.get(row.membershipId) ?? ""),
      authorPhotoUrl: photos.get(row.membershipId) ?? null,
      isYou: row.membershipId === viewerMembershipId,
      parts: bodyParts(row.body, names, copy.issue.unknownMention),
      photoUrl: row.photoUrl,
      createdAt: row.createdAt,
      quote: !row.quoteCommentId
        ? null
        : removed || !target
          ? { author: "", text: copy.issue.quoteRemoved, removed: true }
          : {
              author: target.membershipId === viewerMembershipId ? copy.issue.you : (names.get(target.membershipId) ?? ""),
              text: excerpt(plainBody(target.body, names, copy.issue.unknownMention), QUOTE_EXCERPT),
              removed: false,
            },
    };
  };

  const top: IssueComment[] = [];
  const byReply = new Map<string, IssueComment[]>();
  for (const row of rows) {
    if (!row.replyId) {
      top.push(view(row));
      continue;
    }
    byReply.set(row.replyId, [...(byReply.get(row.replyId) ?? []), view(row)]);
  }

  const mentionables = viewerMembershipId
    ? people
        .filter((person) => person.revokedAt === null && person.id !== viewerMembershipId)
        .map((person) => ({ id: person.id, name: displayName(person), photoUrl: person.photoUrl }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return { top, byReply, mentionables };
}

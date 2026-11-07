import { DEFAULT_REACTIONS, tallyReactions } from "./reaction-emoji.ts";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  groups,
  issueQuestions,
  issues,
  memberships,
  reactions,
  replies,
} from "@/db/schema";
import { copy } from "./copy.ts";
import { loadComments, type IssueComment } from "./comment-view.ts";
import { tallyPoll, type PollTallyRow } from "./poll.ts";
import { musicCardsFor, type MusicProvider, type MusicTrack } from "./sections";
import { issueSections, sectionMedia, sectionReplies } from "@/db/schema";

export type IssueAnswer = {
  replyId: string;
  /** Who wrote it, for reading by person. The name shown is `author`; this one is never "You". */
  authorId: string;
  authorName: string;
  author: string;
  authorPhotoUrl: string | null;
  authorCharm: string | null;
  authorFrame: string | null;
  isYou: boolean;
  body: string;
  photoUrl: string | null;
  audioUrl: string | null;
  audioDurationMs: number | null;
  /** The option texts this person picked on a poll; empty on written questions. */
  choices: string[];
  addedLater: boolean;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  /** The thread on this one answer; always empty when comments are off or the page is shared. */
  comments: IssueComment[];
};

export type IssueSectionReplyBlock = {
  replyId: string;
  authorId: string;
  authorName: string;
  author: string;
  authorPhotoUrl: string | null;
  authorCharm: string | null;
  authorFrame: string | null;
  isYou: boolean;
  body: string;
  linkUrl: string | null;
  linkProvider: string | null;
  linkTitle: string | null;
  linkArtwork: string | null;
  linkTracks: MusicTrack[];
  linkTrackCount: number;
  addedLater: boolean;
  media: Array<{ url: string; caption: string | null }>;
};

export type IssueSectionBlock = {
  id: string;
  kind: "standard" | "photo_wall" | "music";
  title: string;
  emoji: string | null;
  description: string | null;
  replies: IssueSectionReplyBlock[];
};

export type IssuePoll = {
  multiple: boolean;
  /** One row per option. Null until the issue is delivered: no partial results, ever. */
  tally: PollTallyRow[] | null;
  /** How many people picked anything; null while the tally is hidden. */
  voters: number | null;
};

export type IssueBlock = {
  questionId: string;
  question: string;
  /** Frozen credit from when the issue opened: the author's name, or null when anonymous. */
  suggestedBy: string | null;
  poll: IssuePoll | null;
  answers: IssueAnswer[];
};

export type IssueView = {
  issue: typeof issues.$inferSelect;
  group: typeof groups.$inferSelect;
  blocks: IssueBlock[];
  sections: IssueSectionBlock[];
  comments: IssueComment[];
  /** The owner's switch. When false every comment surface is gone, and the lists above are empty. */
  commentsEnabled: boolean;
  /** Who the viewer can @mention; empty for strangers and when comments are off. */
  mentionables: Array<{ id: string; name: string; photoUrl: string | null }>;
  answerCount: number;
};

export function reactionChoices(): readonly string[] {
  return DEFAULT_REACTIONS;
}

/** Everything `/i/<id>` and `/s/<token>` render, in one read. */
export async function loadIssue(input: {
  issueId?: string;
  shareToken?: string;
  viewerMembershipId?: string | null;
  viewerIsAdmin?: boolean;
}): Promise<IssueView | null> {
  // Neither key is a lookup: asking Postgres to cast "" to uuid is a 500, not a
  // missing page. The caller gets the same "nothing here" as any other miss.
  if (!input.shareToken && !input.issueId) return null;

  // A stranger is `null`, and a caller who left the field out is the same
  // stranger — not a member who happens to have no id.
  const viewerMembershipId = input.viewerMembershipId ?? null;

  const [row] = await db
    .select({ issue: issues, group: groups })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(
      input.shareToken
        ? and(
            eq(issues.shareToken, input.shareToken),
            eq(issues.status, "delivered"),
            // Turning sharing off has to mean something: a link handed out
            // yesterday stops working the moment the owner unchecks the box.
            eq(groups.shareEnabled, true),
          )
        : eq(issues.id, input.issueId as string),
    )
    .limit(1);

  if (!row) return null;
  const { issue, group } = row;

  // Comments are a member surface: a share link never shows them, and the owner
  // can switch them off for everyone. Off hides; it never deletes.
  const showComments = group.commentsEnabled && !input.shareToken;

  // Everything below hangs off the issue alone, so it is asked for at once: one
  // round trip to the database instead of one per table.
  const [questions, allRows, threads, reactionRows, sectionRows, allSectionReplyRows, allSectionMediaRows] = await Promise.all([
    db
      .select()
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, issue.id))
      .orderBy(asc(issueQuestions.position)),
    db
      .select({
        replyId: replies.id,
        issueQuestionId: replies.issueQuestionId,
        body: replies.body,
        photoUrl: replies.photoUrl,
        audioUrl: replies.audioUrl,
        audioDurationMs: replies.audioDurationMs,
        pollChoices: replies.pollChoices,
        addedAfterDelivery: replies.addedAfterDelivery,
        membershipId: replies.membershipId,
        name: memberships.name,
        email: memberships.email,
        authorPhotoUrl: memberships.photoUrl,
        authorCharm: memberships.charm,
        authorFrame: memberships.avatarFrame,
      })
      .from(replies)
      .innerJoin(memberships, eq(memberships.id, replies.membershipId))
      .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted"))),
    showComments
      ? loadComments({ issueId: issue.id, groupId: group.id, viewerMembershipId })
      : Promise.resolve({ top: [], byReply: new Map<string, IssueComment[]>(), mentionables: [] }),
    // Every reaction on this issue's answers; the ones on answers this viewer may
    // not see are simply never looked up below.
    db
      .select({ replyId: reactions.replyId, membershipId: reactions.membershipId, emoji: reactions.emoji, createdAt: reactions.createdAt })
      .from(reactions)
      .innerJoin(replies, eq(replies.id, reactions.replyId))
      .where(eq(replies.issueId, issue.id)),
    db
      .select()
      .from(issueSections)
      .where(eq(issueSections.issueId, issue.id))
      .orderBy(asc(issueSections.position)),
    db
      .select({
        replyId: sectionReplies.id,
        issueSectionId: sectionReplies.issueSectionId,
        body: sectionReplies.body,
        linkUrl: sectionReplies.linkUrl,
        linkProvider: sectionReplies.linkProvider,
        addedAfterDelivery: sectionReplies.addedAfterDelivery,
        membershipId: sectionReplies.membershipId,
        name: memberships.name,
        email: memberships.email,
        authorPhotoUrl: memberships.photoUrl,
        authorCharm: memberships.charm,
        authorFrame: memberships.avatarFrame,
      })
      .from(sectionReplies)
      .innerJoin(memberships, eq(memberships.id, sectionReplies.membershipId))
      .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted"))),
    db
      .select({ sectionReplyId: sectionMedia.sectionReplyId, url: sectionMedia.url, caption: sectionMedia.caption })
      .from(sectionMedia)
      .innerJoin(sectionReplies, eq(sectionReplies.id, sectionMedia.sectionReplyId))
      .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted")))
      .orderBy(asc(sectionMedia.position)),
  ]);

  // Polls keep their results back until the issue goes out: before then, the only
  // pick anyone can see is their own. A pick cleared after sending is not an answer.
  const delivered = issue.status === "delivered";
  const pollIds = new Set(questions.filter((question) => question.kind === "poll").map((question) => question.id));
  const rows = allRows.filter((row) => {
    if (!pollIds.has(row.issueQuestionId)) return true;
    if (row.pollChoices.length === 0) return false;
    return delivered || row.membershipId === viewerMembershipId;
  });

  const reactionsByReply = new Map<string, typeof reactionRows>();
  for (const reaction of reactionRows) {
    reactionsByReply.set(reaction.replyId, [...(reactionsByReply.get(reaction.replyId) ?? []), reaction]);
  }

  const blocks: IssueBlock[] = questions.map((question) => ({
    questionId: question.id,
    question: question.text,
    suggestedBy: question.suggestedBy,
    poll:
      question.kind === "poll"
        ? {
            multiple: question.pollMultiple,
            tally: delivered
              ? tallyPoll(
                  question.pollOptions ?? [],
                  rows.filter((row) => row.issueQuestionId === question.id).map((row) => row.pollChoices),
                )
              : null,
            voters: delivered ? rows.filter((row) => row.issueQuestionId === question.id).length : null,
          }
        : null,
    answers: rows
      .filter((row) => row.issueQuestionId === question.id)
      .map((row) => {
        const mine = viewerMembershipId === row.membershipId;
        const forReply = reactionsByReply.get(row.replyId) ?? [];
        return {
          replyId: row.replyId,
          authorId: row.membershipId,
          authorName: row.name ?? row.email.split("@")[0],
          author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
          authorPhotoUrl: row.authorPhotoUrl,
          authorCharm: row.authorCharm,
          authorFrame: row.authorFrame,
          isYou: mine,
          body: row.body,
          photoUrl: row.photoUrl,
          audioUrl: row.audioUrl,
          audioDurationMs: row.audioDurationMs,
          choices: row.pollChoices.flatMap((index) => question.pollOptions?.[index] ?? []),
          addedLater: row.addedAfterDelivery,
          comments: threads.byReply.get(row.replyId) ?? [],
          reactions: tallyReactions(forReply, viewerMembershipId),
        };
      }),
  }));

  const visibleSections = sectionRows.filter((section) => !section.adminOnly || input.viewerIsAdmin);
  const visibleIds = new Set(visibleSections.map((section) => section.id));
  const sectionReplyRows = allSectionReplyRows.filter((row) => visibleIds.has(row.issueSectionId));
  const shownReplies = new Set(sectionReplyRows.map((row) => row.replyId));
  const sectionMediaRows = allSectionMediaRows.filter((row) => shownReplies.has(row.sectionReplyId));

  const musicCards = await musicCardsFor(sectionReplyRows.flatMap((row) =>
    row.linkUrl && row.linkProvider ? [{ provider: row.linkProvider as MusicProvider, url: row.linkUrl }] : []));

  const sections: IssueSectionBlock[] = visibleSections.map((section) => ({
    id: section.id,
    kind: section.kind,
    title: section.title,
    emoji: section.emoji,
    description: section.description,
    replies: sectionReplyRows
      .filter((row) => row.issueSectionId === section.id)
      .map((row) => {
        const mine = input.viewerMembershipId === row.membershipId;
        const card = row.linkUrl ? musicCards.get(row.linkUrl) : undefined;
        return {
          replyId: row.replyId,
          authorId: row.membershipId,
          authorName: row.name ?? row.email.split("@")[0],
          author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
          authorPhotoUrl: row.authorPhotoUrl,
          authorCharm: row.authorCharm,
          authorFrame: row.authorFrame,
          isYou: mine,
          body: row.body,
          linkUrl: row.linkUrl,
          linkProvider: row.linkProvider,
          linkTitle: card?.title ?? null,
          linkArtwork: card?.artworkUrl ?? null,
          linkTracks: card?.tracks ?? [],
          linkTrackCount: card?.trackCount ?? 0,
          addedLater: row.addedAfterDelivery,
          media: sectionMediaRows
            .filter((item) => item.sectionReplyId === row.replyId)
            .map((item) => ({ url: item.url, caption: item.caption })),
        };
      }),
  }));

  return {
    issue,
    group,
    blocks,
    sections,
    // Section replies are answers too: a photo wall or a birthday note counts.
    answerCount: rows.length + sectionReplyRows.length,
    comments: threads.top,
    commentsEnabled: group.commentsEnabled,
    mentionables: threads.mentionables,
  };
}

/** The loop an issue belongs to, or null: all a page needs before it knows who is reading. */
export async function issueGroupId(issueId: string): Promise<string | null> {
  if (!issueId) return null;
  const [row] = await db.select({ groupId: issues.groupId }).from(issues).where(eq(issues.id, issueId)).limit(1);
  return row?.groupId ?? null;
}

/** Who is looking: a signed-in member, or the token in the delivery link. */
export async function membershipForViewer(input: {
  groupId: string;
  userId?: string | null;
  token?: string | null;
}) {
  if (input.userId) {
    const [row] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.groupId, input.groupId),
          eq(memberships.userId, input.userId),
          isNull(memberships.revokedAt),
        ),
      )
      .limit(1);
    if (row) return row;
  }

  if (input.token) {
    const [row] = await db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.replyToken, input.token),
          eq(memberships.groupId, input.groupId),
          isNull(memberships.revokedAt),
        ),
      )
      .limit(1);
    if (row) return row;
  }

  return null;
}

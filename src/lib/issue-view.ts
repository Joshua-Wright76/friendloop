import { and, asc, eq, inArray, isNull } from "drizzle-orm";
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
import { musicCardFor } from "./sections";
import { issueSections, sectionMedia, sectionReplies } from "@/db/schema";

export type IssueAnswer = {
  replyId: string;
  author: string;
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
  author: string;
  isYou: boolean;
  body: string;
  linkUrl: string | null;
  linkProvider: string | null;
  linkTitle: string | null;
  linkArtwork: string | null;
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
  mentionables: Array<{ id: string; name: string }>;
  answerCount: number;
};

const REACTIONS = ["❤️", "😄", "👏"];

export function reactionChoices(): string[] {
  return REACTIONS;
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

  const questions = await db
    .select()
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, issue.id))
    .orderBy(asc(issueQuestions.position));

  const allRows = await db
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
    })
    .from(replies)
    .innerJoin(memberships, eq(memberships.id, replies.membershipId))
    .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")));

  // Polls keep their results back until the issue goes out: before then, the only
  // pick anyone can see is their own. A pick cleared after sending is not an answer.
  const delivered = issue.status === "delivered";
  const pollIds = new Set(questions.filter((question) => question.kind === "poll").map((question) => question.id));
  const rows = allRows.filter((row) => {
    if (!pollIds.has(row.issueQuestionId)) return true;
    if (row.pollChoices.length === 0) return false;
    return delivered || row.membershipId === viewerMembershipId;
  });

  // Comments are a member surface: a share link never shows them, and the owner
  // can switch them off for everyone. Off hides; it never deletes.
  const showComments = group.commentsEnabled && !input.shareToken;
  const threads = showComments
    ? await loadComments({ issueId: issue.id, groupId: group.id, viewerMembershipId })
    : { top: [], byReply: new Map<string, IssueComment[]>(), mentionables: [] };

  const replyIds = rows.map((row) => row.replyId);
  const reactionRows = replyIds.length
    ? await db.select().from(reactions).where(inArray(reactions.replyId, replyIds))
    : [];

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
        const forReply = reactionRows.filter((reaction) => reaction.replyId === row.replyId);
        return {
          replyId: row.replyId,
          author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
          isYou: mine,
          body: row.body,
          photoUrl: row.photoUrl,
          audioUrl: row.audioUrl,
          audioDurationMs: row.audioDurationMs,
          choices: row.pollChoices.flatMap((index) => question.pollOptions?.[index] ?? []),
          addedLater: row.addedAfterDelivery,
          comments: threads.byReply.get(row.replyId) ?? [],
          reactions: REACTIONS.map((emoji) => ({
            emoji,
            count: forReply.filter((reaction) => reaction.emoji === emoji).length,
            mine: forReply.some(
              (reaction) => reaction.emoji === emoji && reaction.membershipId === viewerMembershipId,
            ),
          })).filter((reaction) => reaction.count > 0 || viewerMembershipId !== null),
        };
      }),
  }));

  const sectionRows = await db
    .select()
    .from(issueSections)
    .where(eq(issueSections.issueId, issue.id))
    .orderBy(asc(issueSections.position));

  const visibleSections = sectionRows.filter((section) => !section.adminOnly || input.viewerIsAdmin);

  const sectionReplyRows = visibleSections.length
    ? await db
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
        })
        .from(sectionReplies)
        .innerJoin(memberships, eq(memberships.id, sectionReplies.membershipId))
        .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted")))
    : [];

  const sectionMediaRows = sectionReplyRows.length
    ? await db
        .select()
        .from(sectionMedia)
        .where(inArray(sectionMedia.sectionReplyId, sectionReplyRows.map((row) => row.replyId)))
        .orderBy(asc(sectionMedia.position))
    : [];

  const musicCards = new Map<string, { title: string; artworkUrl: string | null }>();
  for (const row of sectionReplyRows) {
    if (row.linkUrl && row.linkProvider) {
      const provider = row.linkProvider as "spotify" | "bandcamp" | "qobuz";
      musicCards.set(row.linkUrl, await musicCardFor(provider, row.linkUrl));
    }
  }

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
          author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
          isYou: mine,
          body: row.body,
          linkUrl: row.linkUrl,
          linkProvider: row.linkProvider,
          linkTitle: card?.title ?? null,
          linkArtwork: card?.artworkUrl ?? null,
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
    answerCount: rows.length,
    comments: threads.top,
    commentsEnabled: group.commentsEnabled,
    mentionables: threads.mentionables,
  };
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

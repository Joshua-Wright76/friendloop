import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  comments,
  groups,
  issueMoods,
  issuePicks,
  issueQuestions,
  issues,
  memberships,
  reactions,
  replies,
} from "@/db/schema";
import { copy } from "./copy.ts";
import {
  memberColor,
  mostLovedReplyIds,
  type MemberColor,
  type QuestionKind,
} from "./issue-experience.ts";

export type IssueAnswer = {
  replyId: string;
  author: string;
  isYou: boolean;
  body: string;
  photoUrl: string | null;
  addedLater: boolean;
  color: MemberColor;
  reactionCount: number;
  editorPick: boolean;
  mostLoved: boolean;
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
};

export type IssueBlock = {
  questionId: string;
  question: string;
  kind: QuestionKind;
  answers: IssueAnswer[];
};

export type IssueMood = {
  id: string;
  author: string;
  emoji: string;
  color: MemberColor;
};

export type IssuePick = {
  replyId: string;
  question: string;
  author: string;
  body: string;
  photoUrl: string | null;
  editorPick: boolean;
  mostLoved: boolean;
};

export type IssueComment = {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
  color: MemberColor;
};

export type IssueView = {
  issue: typeof issues.$inferSelect;
  group: typeof groups.$inferSelect;
  blocks: IssueBlock[];
  moods: IssueMood[];
  picks: IssuePick[];
  comments: IssueComment[];
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
}): Promise<IssueView | null> {
  const [issue] = await db
    .select()
    .from(issues)
    .where(
      input.shareToken
        ? and(eq(issues.shareToken, input.shareToken), eq(issues.status, "delivered"))
        : eq(issues.id, input.issueId ?? ""),
    )
    .limit(1);

  if (!issue) return null;

  const [group] = await db.select().from(groups).where(eq(groups.id, issue.groupId)).limit(1);
  if (!group) return null;

  const viewerId = input.viewerMembershipId ?? null;
  const questions = await db
    .select()
    .from(issueQuestions)
    .where(eq(issueQuestions.issueId, issue.id))
    .orderBy(asc(issueQuestions.position));

  const rows = await db
    .select({
      replyId: replies.id,
      issueQuestionId: replies.issueQuestionId,
      body: replies.body,
      photoUrl: replies.photoUrl,
      addedAfterDelivery: replies.addedAfterDelivery,
      membershipId: replies.membershipId,
      name: memberships.name,
      email: memberships.email,
    })
    .from(replies)
    .innerJoin(memberships, eq(memberships.id, replies.membershipId))
    .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")))
    .orderBy(asc(replies.createdAt), asc(replies.id));

  const replyIds = rows.map((row) => row.replyId);
  const [reactionRows, pickRows] = await Promise.all([
    replyIds.length
      ? db.select().from(reactions).where(inArray(reactions.replyId, replyIds))
      : Promise.resolve([]),
    db.select({ replyId: issuePicks.replyId }).from(issuePicks).where(eq(issuePicks.issueId, issue.id)),
  ]);
  const pickedIds = new Set(pickRows.map((row) => row.replyId));

  const blocks: IssueBlock[] = questions.map((question) => ({
    questionId: question.id,
    question: question.text,
    kind: question.kind,
    answers: rows
      .filter((row) => row.issueQuestionId === question.id)
      .map((row) => {
        const mine = viewerId === row.membershipId;
        const forReply = reactionRows.filter((reaction) => reaction.replyId === row.replyId);
        return {
          replyId: row.replyId,
          author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
          isYou: mine,
          body: row.body,
          photoUrl: row.photoUrl,
          addedLater: row.addedAfterDelivery,
          color: memberColor(row.membershipId),
          reactionCount: forReply.length,
          editorPick: pickedIds.has(row.replyId),
          mostLoved: false,
          reactions: REACTIONS.map((emoji) => ({
            emoji,
            count: forReply.filter((reaction) => reaction.emoji === emoji).length,
            mine: forReply.some(
              (reaction) => reaction.emoji === emoji && reaction.membershipId === viewerId,
            ),
          })).filter((reaction) => reaction.count > 0 || viewerId !== null),
        };
      }),
  }));

  const lovedIds = new Set(mostLovedReplyIds(blocks.flatMap((block) => block.answers)));
  for (const block of blocks) {
    for (const answer of block.answers) answer.mostLoved = lovedIds.has(answer.replyId);
  }

  const picks = blocks.flatMap((block) => block.answers
    .filter((answer) => answer.editorPick || answer.mostLoved)
    .map((answer) => ({
      replyId: answer.replyId,
      question: block.question,
      author: answer.author,
      body: answer.body,
      photoUrl: answer.photoUrl,
      editorPick: answer.editorPick,
      mostLoved: answer.mostLoved,
    })));

  const [moodRows, commentRows] = await Promise.all([
    db
      .select({
        id: issueMoods.id,
        emoji: issueMoods.emoji,
        membershipId: issueMoods.membershipId,
        name: memberships.name,
        email: memberships.email,
      })
      .from(issueMoods)
      .innerJoin(memberships, eq(memberships.id, issueMoods.membershipId))
      .where(eq(issueMoods.issueId, issue.id))
      .orderBy(asc(memberships.createdAt), asc(issueMoods.id)),
    db
      .select({
        id: comments.id,
        body: comments.body,
        createdAt: comments.createdAt,
        name: memberships.name,
        email: memberships.email,
        membershipId: comments.membershipId,
      })
      .from(comments)
      .innerJoin(memberships, eq(memberships.id, comments.membershipId))
      .where(eq(comments.issueId, issue.id))
      .orderBy(asc(comments.createdAt)),
  ]);

  return {
    issue,
    group,
    blocks,
    picks,
    answerCount: rows.length,
    moods: moodRows.map((row) => ({
      id: row.id,
      author: row.membershipId === viewerId ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
      emoji: row.emoji,
      color: memberColor(row.membershipId),
    })),
    comments: commentRows.map((row) => ({
      id: row.id,
      author:
        row.membershipId === viewerId ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
      body: row.body,
      createdAt: row.createdAt,
      color: memberColor(row.membershipId),
    })),
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
      .where(and(
        eq(memberships.groupId, input.groupId),
        eq(memberships.userId, input.userId),
        isNull(memberships.revokedAt),
      ))
      .limit(1);
    if (row) return row;
  }

  if (input.token) {
    const [row] = await db
      .select()
      .from(memberships)
      .where(and(
        eq(memberships.replyToken, input.token),
        eq(memberships.groupId, input.groupId),
        isNull(memberships.revokedAt),
      ))
      .limit(1);
    if (row) return row;
  }

  return null;
}

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  comments,
  groups,
  issueQuestions,
  issueSections,
  issues,
  memberships,
  questionSuggestions,
  questions,
  reactions,
  replies,
  sectionMedia,
  sectionReplies,
  users,
  type Group,
  type Membership,
} from "@/db/schema";
import { copy } from "./copy.ts";
import { plainBody } from "./mentions.ts";
import { appUrl } from "./urls.ts";

/**
 * Taking your words with you.
 *
 * Exports are JSON, streamed one loop (or one round) at a time so a long-lived
 * loop never has to sit in a serverless function's memory at once. Photos and
 * voice notes travel as links rather than bytes: they already live at
 * permanent, unguessable addresses, and fetching every file into a ZIP inside
 * one function call would run into the platform's time and size limits long
 * before a real loop's archive did. The links keep working until the files'
 * owner, or the loop, is deleted, which the file says.
 */

export const EXPORT_FORMAT = "friendloop-export/1";

type Names = Map<string, string>;

function displayName(member: { name: string | null; email: string }): string {
  return member.name ?? member.email.split("@")[0];
}

function absolute(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url, `${appUrl()}/`).toString();
  } catch {
    return url;
  }
}

function picks(options: string[] | null, choices: number[]): string[] {
  return choices.map((choice) => options?.[choice]).filter((label): label is string => typeof label === "string");
}

async function namesIn(groupId: string): Promise<Names> {
  const rows = await db
    .select({ id: memberships.id, name: memberships.name, email: memberships.email })
    .from(memberships)
    .where(eq(memberships.groupId, groupId));
  return new Map(rows.map((row) => [row.id, displayName(row)]));
}

function indent(json: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return pad + json.replace(/\n/g, `\n${pad}`);
}

/**
 * One JSON document, written as it is read: the head object's fields, then a
 * list whose items arrive one at a time. The concatenated chunks parse as JSON.
 */
export async function* jsonDocument(
  head: Record<string, unknown>,
  listKey: string,
  items: AsyncIterable<unknown>,
): AsyncGenerator<string> {
  const opening = JSON.stringify(head, null, 2);
  yield `${opening.slice(0, -2)},\n  ${JSON.stringify(listKey)}: [`;
  let first = true;
  for await (const item of items) {
    yield `${first ? "\n" : ",\n"}${indent(JSON.stringify(item, null, 2), 4)}`;
    first = false;
  }
  yield first ? "]\n}\n" : "\n  ]\n}\n";
}

/** Feed a chunk generator to a Response body. */
export function toStream(chunks: AsyncGenerator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      const next = await chunks.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await chunks.return(undefined);
    },
  });
}

export function exportFilename(subject: string, at: Date): string {
  const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "export";
  return `friendloop-${slug}-${at.toISOString().slice(0, 10)}.json`;
}

/* ------------------------- one person's words ------------------------- */

/** Everything one membership wrote in its loop, drafts included: it is theirs. */
async function contributionsOf(membership: Membership, group: Pick<Group, "id" | "name">) {
  const names = await namesIn(group.id);

  const answers = await db
    .select({ reply: replies, question: issueQuestions, issue: issues })
    .from(replies)
    .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
    .innerJoin(issues, eq(issues.id, replies.issueId))
    .where(eq(replies.membershipId, membership.id))
    .orderBy(asc(issues.number), asc(issueQuestions.position));

  const sectionAnswers = await db
    .select({ reply: sectionReplies, section: issueSections, issue: issues })
    .from(sectionReplies)
    .innerJoin(issueSections, eq(issueSections.id, sectionReplies.issueSectionId))
    .innerJoin(issues, eq(issues.id, sectionReplies.issueId))
    .where(eq(sectionReplies.membershipId, membership.id))
    .orderBy(asc(issues.number), asc(issueSections.position));
  const media = sectionAnswers.length === 0 ? [] : await db
    .select()
    .from(sectionMedia)
    .where(inArray(sectionMedia.sectionReplyId, sectionAnswers.map((row) => row.reply.id)))
    .orderBy(asc(sectionMedia.position));

  const written = await db
    .select({ comment: comments, issue: issues })
    .from(comments)
    .innerJoin(issues, eq(issues.id, comments.issueId))
    .where(eq(comments.membershipId, membership.id))
    .orderBy(asc(comments.createdAt));

  const reacted = await db
    .select({ reaction: reactions, question: issueQuestions, issue: issues, authorId: replies.membershipId })
    .from(reactions)
    .innerJoin(replies, eq(replies.id, reactions.replyId))
    .innerJoin(issueQuestions, eq(issueQuestions.id, replies.issueQuestionId))
    .innerJoin(issues, eq(issues.id, replies.issueId))
    .where(eq(reactions.membershipId, membership.id))
    .orderBy(asc(reactions.createdAt));

  const suggested = await db
    .select()
    .from(questionSuggestions)
    .where(eq(questionSuggestions.membershipId, membership.id))
    .orderBy(asc(questionSuggestions.createdAt));

  return {
    loop: group.name,
    you: {
      name: membership.name,
      email: membership.email,
      access: membership.access,
      participation: membership.participation,
      photoUrl: absolute(membership.photoUrl),
      charm: membership.charm,
      avatarFrame: membership.avatarFrame,
      invitedAt: membership.invitedAt,
      acceptedAt: membership.acceptedAt,
    },
    answers: answers.map(({ reply, question, issue }) => ({
      round: issue.number,
      roundName: issue.name,
      question: question.text,
      answer: reply.body,
      pollChoices: picks(question.pollOptions, reply.pollChoices),
      photoUrl: absolute(reply.photoUrl),
      audioUrl: absolute(reply.audioUrl),
      status: reply.status,
      submittedAt: reply.submittedAt,
      updatedAt: reply.updatedAt,
    })),
    sectionAnswers: sectionAnswers.map(({ reply, section, issue }) => ({
      round: issue.number,
      roundName: issue.name,
      section: section.title,
      answer: reply.body,
      linkUrl: reply.linkUrl,
      photos: media
        .filter((item) => item.sectionReplyId === reply.id)
        .map((item) => ({ url: absolute(item.url), caption: item.caption })),
      status: reply.status,
      submittedAt: reply.submittedAt,
    })),
    comments: written.map(({ comment, issue }) => ({
      round: issue.number,
      comment: plainBody(comment.body, names, copy.issue.unknownMention),
      photoUrl: absolute(comment.photoUrl),
      createdAt: comment.createdAt,
      removedAt: comment.deletedAt,
    })),
    reactions: reacted.map(({ reaction, question, issue, authorId }) => ({
      round: issue.number,
      question: question.text,
      answerBy: names.get(authorId) ?? copy.issue.unknownMention,
      emoji: reaction.emoji,
    })),
    suggestions: suggested.map((suggestion) => ({
      question: suggestion.text,
      status: suggestion.status,
      credit: suggestion.authorDisplay,
      createdAt: suggestion.createdAt,
    })),
  };
}

function personalHead(at: Date, account: Record<string, unknown> | null) {
  return {
    format: EXPORT_FORMAT,
    exportedAt: at.toISOString(),
    about: copy.legal.export.personalNote,
    ...(account ? { account } : {}),
  };
}

async function* eachContribution(rows: Array<{ membership: Membership; group: Group }>) {
  for (const row of rows) yield await contributionsOf(row.membership, row.group);
}

/** A signed-in person's own words across every loop they are, or were, in. */
export async function accountExport(userId: string, at: Date): Promise<AsyncGenerator<string> | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return null;

  const rows = await db
    .select({ membership: memberships, group: groups })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(eq(memberships.userId, user.id))
    .orderBy(asc(groups.createdAt));

  const head = personalHead(at, {
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    createdAt: user.createdAt,
  });
  return jsonDocument(head, "loops", eachContribution(rows));
}

/** The same, for someone who only holds a reply link: just this loop. */
export async function replyLinkExport(token: string, at: Date): Promise<{ groupName: string; chunks: AsyncGenerator<string> } | null> {
  const [row] = await db
    .select({ membership: memberships, group: groups })
    .from(memberships)
    .innerJoin(groups, eq(groups.id, memberships.groupId))
    .where(and(eq(memberships.replyToken, token), isNull(memberships.revokedAt)))
    .limit(1);
  if (!row) return null;
  return { groupName: row.group.name, chunks: jsonDocument(personalHead(at, null), "loops", eachContribution([row])) };
}

/* --------------------------- a whole loop --------------------------- */

async function roundOf(issue: typeof issues.$inferSelect, names: Names) {
  // One round trip per round: everything here hangs off the issue id alone.
  const [asked, answered, carried, sectionAnswers, media, thread, reacted] = await Promise.all([
    db
      .select()
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, issue.id))
      .orderBy(asc(issueQuestions.position)),
    db
      .select()
      .from(replies)
      .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")))
      .orderBy(asc(replies.submittedAt)),
    db
      .select()
      .from(issueSections)
      .where(eq(issueSections.issueId, issue.id))
      .orderBy(asc(issueSections.position)),
    db
      .select()
      .from(sectionReplies)
      .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted")))
      .orderBy(asc(sectionReplies.submittedAt)),
    db
      .select({ sectionReplyId: sectionMedia.sectionReplyId, url: sectionMedia.url, caption: sectionMedia.caption })
      .from(sectionMedia)
      .innerJoin(sectionReplies, eq(sectionReplies.id, sectionMedia.sectionReplyId))
      .where(and(eq(sectionReplies.issueId, issue.id), eq(sectionReplies.status, "submitted")))
      .orderBy(asc(sectionMedia.position)),
    db
      .select()
      .from(comments)
      .where(and(eq(comments.issueId, issue.id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt)),
    db
      .select({ replyId: reactions.replyId, membershipId: reactions.membershipId, emoji: reactions.emoji })
      .from(reactions)
      .innerJoin(replies, eq(replies.id, reactions.replyId))
      .where(and(eq(replies.issueId, issue.id), eq(replies.status, "submitted")))
      .orderBy(asc(reactions.createdAt)),
  ]);

  const author = (membershipId: string) => names.get(membershipId) ?? copy.issue.unknownMention;

  return {
    round: issue.number,
    name: issue.name,
    status: issue.status,
    opensAt: issue.opensAt,
    deliversAt: issue.deliversAt,
    deliveredAt: issue.deliveredAt,
    questions: asked.map((question) => ({
      question: question.text,
      kind: question.kind,
      ...(question.kind === "poll" ? { options: question.pollOptions, multiple: question.pollMultiple } : {}),
      suggestedBy: question.suggestedBy,
      answers: answered
        .filter((reply) => reply.issueQuestionId === question.id)
        .map((reply) => ({
          id: reply.id,
          by: author(reply.membershipId),
          answer: reply.body,
          pollChoices: picks(question.pollOptions, reply.pollChoices),
          photoUrl: absolute(reply.photoUrl),
          audioUrl: absolute(reply.audioUrl),
          submittedAt: reply.submittedAt,
          addedLate: reply.addedAfterDelivery,
          reactions: reacted
            .filter((reaction) => reaction.replyId === reply.id)
            .map((reaction) => ({ by: author(reaction.membershipId), emoji: reaction.emoji })),
        })),
    })),
    sections: carried.map((section) => ({
      section: section.title,
      kind: section.kind,
      emoji: section.emoji,
      description: section.description,
      answers: sectionAnswers
        .filter((reply) => reply.issueSectionId === section.id)
        .map((reply) => ({
          by: author(reply.membershipId),
          answer: reply.body,
          linkUrl: reply.linkUrl,
          photos: media
            .filter((item) => item.sectionReplyId === reply.id)
            .map((item) => ({ url: absolute(item.url), caption: item.caption })),
          addedLate: reply.addedAfterDelivery,
        })),
    })),
    comments: thread.map((comment) => ({
      id: comment.id,
      by: author(comment.membershipId),
      comment: plainBody(comment.body, names, copy.issue.unknownMention),
      onAnswer: comment.replyId,
      quoting: comment.quoteCommentId,
      photoUrl: absolute(comment.photoUrl),
      createdAt: comment.createdAt,
    })),
  };
}

async function* eachRound(groupId: string, names: Names) {
  const rounds = await db.select().from(issues).where(eq(issues.groupId, groupId)).orderBy(asc(issues.number));
  for (const issue of rounds) yield await roundOf(issue, names);
}

/** The owner's archive of a loop: every round, question, answer, comment and file link. */
export async function loopArchive(groupId: string, at: Date): Promise<{ groupName: string; chunks: AsyncGenerator<string> } | null> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) return null;

  const members = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), isNull(memberships.revokedAt)))
    .orderBy(asc(memberships.invitedAt));
  const pool = await db.select().from(questions).where(eq(questions.groupId, groupId)).orderBy(asc(questions.position));
  const names = await namesIn(groupId);

  const head = {
    format: EXPORT_FORMAT,
    exportedAt: at.toISOString(),
    about: copy.legal.export.loopNote,
    loop: {
      name: group.name,
      timezone: group.timezone,
      cadenceWeeks: group.cadenceWeeks,
      headerImageUrl: absolute(group.headerImageUrl),
      createdAt: group.createdAt,
    },
    members: members.map((member) => ({
      name: displayName(member),
      email: member.email,
      access: member.access,
      participation: member.participation,
      photoUrl: absolute(member.photoUrl),
    })),
    questionPool: pool.map((question) => ({
      question: question.text,
      kind: question.kind,
      ...(question.kind === "poll" ? { options: question.pollOptions } : {}),
      archived: question.archivedAt !== null,
    })),
  };
  return { groupName: group.name, chunks: jsonDocument(head, "rounds", eachRound(groupId, names)) };
}

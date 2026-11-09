import { DEFAULT_REACTIONS, tallyReactions } from "./reaction-emoji.ts";
import { and, asc, eq, exists, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { replyHasContentCondition } from "./reply-query";
import {
  groups,
  issueQuestions,
  issueStatusLines,
  issues,
  memberships,
  reactions,
  replies,
  replyMedia,
} from "@/db/schema";
import { copy } from "./copy.ts";
import { loadComments, type IssueComment } from "./comment-view.ts";
import { tallyPoll, type PollTallyRow } from "./poll.ts";
import { musicCardsFor, type MusicProvider, type MusicTrack } from "./music";
import { formatOf } from "./asks";
import { isStickerKey, parseSignature } from "./looks.ts";

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
  /** A music pick's card. Only on music answers, so other answers read exactly as they always have. */
  link?: IssueLink;
  /** A photo wall's photos. Only on photo-wall answers. */
  media?: Array<{ url: string; caption: string | null }>;
  /** The sticker its author slapped on it; only there when they did. */
  sticker?: string;
};

export type IssueLink = {
  url: string;
  provider: string | null;
  title: string | null;
  artworkUrl: string | null;
  tracks: MusicTrack[];
  trackCount: number;
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
  /** Former section answers take reactions and comments like any other answer. */
  reactions: Array<{ emoji: string; count: number; mine: boolean }>;
  comments: IssueComment[];
  sticker?: string;
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
  /** Set for a photo wall or a music pick; a written or poll item leaves it out. */
  format?: "photo_wall" | "music";
  emoji?: string;
  description?: string;
};

/** Someone's line for this round ("currently…"), for the roll call and beside their answers. */
export type IssueStatusLine = {
  id: string;
  name: string;
  photoUrl: string | null;
  charm: string | null;
  frame: string | null;
  body: string;
};

/** The signature of someone who wrote in a delivered round, for its signed card and their sign-off. */
export type IssueSignature = { id: string; name: string; strokes: number[][] };

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
  /** Everyone's line this round that the viewer may see, by name. Left out when there are none. */
  statusLines?: IssueStatusLine[];
  /** A delivered round's signatures, of those who wrote in it, by name. Left out when there are none. */
  signatures?: IssueSignature[];
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
  const delivered = issue.status === "delivered";
  const [asked, allRows, threads, reactionRows, allMedia, lineRows, signerRows] = await Promise.all([
    db
      .select()
      .from(issueQuestions)
      .where(eq(issueQuestions.issueId, issue.id))
      .orderBy(asc(issueQuestions.position), asc(issueQuestions.id)),
    db
      .select({
        replyId: replies.id,
        issueQuestionId: replies.issueQuestionId,
        body: replies.body,
        photoUrl: replies.photoUrl,
        audioUrl: replies.audioUrl,
        audioDurationMs: replies.audioDurationMs,
        pollChoices: replies.pollChoices,
        linkUrl: replies.linkUrl,
        linkProvider: replies.linkProvider,
        sticker: replies.sticker,
        addedAfterDelivery: replies.addedAfterDelivery,
        createdAt: replies.createdAt,
        membershipId: replies.membershipId,
        name: memberships.name,
        email: memberships.email,
        authorPhotoUrl: memberships.photoUrl,
        authorCharm: memberships.charm,
        authorFrame: memberships.avatarFrame,
      })
      .from(replies)
      .innerJoin(memberships, eq(memberships.id, replies.membershipId))
      .where(and(eq(replies.issueId, issue.id), replyHasContentCondition()))
      .orderBy(asc(replies.createdAt), asc(replies.id)),
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
      .select({ replyId: replyMedia.replyId, url: replyMedia.url, caption: replyMedia.caption })
      .from(replyMedia)
      .innerJoin(replies, eq(replies.id, replyMedia.replyId))
      .where(eq(replies.issueId, issue.id))
      .orderBy(asc(replyMedia.position), asc(replyMedia.createdAt), asc(replyMedia.id)),
    db
      .select({
        id: issueStatusLines.membershipId,
        body: issueStatusLines.body,
        name: memberships.name,
        email: memberships.email,
        photoUrl: memberships.photoUrl,
        charm: memberships.charm,
        frame: memberships.avatarFrame,
      })
      .from(issueStatusLines)
      .innerJoin(memberships, eq(memberships.id, issueStatusLines.membershipId))
      .where(eq(issueStatusLines.issueId, issue.id)),
    // Signatures close a round that has gone out: only of the people who wrote in it.
    delivered
      ? db
          .select({ id: memberships.id, signature: memberships.signature, name: memberships.name, email: memberships.email })
          .from(memberships)
          .where(and(
            eq(memberships.groupId, group.id),
            isNotNull(memberships.signature),
            exists(db.select({ id: replies.id }).from(replies).where(and(eq(replies.issueId, issue.id), eq(replies.membershipId, memberships.id)))),
          ))
      : Promise.resolve([]),
  ]);

  // A round is a surprise until it goes out. Whatever someone has written counts
  // as their answer, half-finished sentences included, so before delivery the only
  // answers anyone sees are their own; poll results wait the same way. Owners-only
  // items are for the owner and admins.
  const visibleNow = (membershipId: string) => delivered || membershipId === viewerMembershipId;
  const shown = asked.filter((question) => !question.adminOnly || input.viewerIsAdmin);
  const shownIds = new Set(shown.map((question) => question.id));
  const rows = allRows.filter((row) => shownIds.has(row.issueQuestionId) && visibleNow(row.membershipId));

  const reactionsByReply = new Map<string, typeof reactionRows>();
  for (const reaction of reactionRows) {
    reactionsByReply.set(reaction.replyId, [...(reactionsByReply.get(reaction.replyId) ?? []), reaction]);
  }
  const mediaByReply = new Map<string, Array<{ url: string; caption: string | null }>>();
  for (const item of allMedia) {
    mediaByReply.set(item.replyId, [...(mediaByReply.get(item.replyId) ?? []), { url: item.url, caption: item.caption }]);
  }
  const musicCards = await musicCardsFor(rows.flatMap((row) =>
    row.linkUrl && row.linkProvider ? [{ provider: row.linkProvider as MusicProvider, url: row.linkUrl }] : []));

  const byline = (row: (typeof rows)[number]) => {
    const mine = viewerMembershipId === row.membershipId;
    return {
      replyId: row.replyId,
      authorId: row.membershipId,
      authorName: row.name ?? row.email.split("@")[0],
      author: mine ? copy.issue.you : (row.name ?? row.email.split("@")[0]),
      authorPhotoUrl: row.authorPhotoUrl,
      authorCharm: row.authorCharm,
      authorFrame: row.authorFrame,
      isYou: mine,
    };
  };
  const conversation = (row: (typeof rows)[number]) => ({
    reactions: tallyReactions(reactionsByReply.get(row.replyId) ?? [], viewerMembershipId),
    comments: threads.byReply.get(row.replyId) ?? [],
  });
  const cardOf = (url: string) => musicCards.get(url);
  // Only a sticker someone chose: an answer without one reads exactly as it always has.
  const stickerOf = (row: (typeof rows)[number]) => (isStickerKey(row.sticker) ? { sticker: row.sticker } : {});
  const nameOf = (row: { name: string | null; email: string }) => row.name ?? row.email.split("@")[0];
  const byName = (a: { name: string; id: string }, b: { name: string; id: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

  // A line is a surprise like an answer: before the round goes out, only your own shows.
  const statusLines: IssueStatusLine[] = lineRows
    .filter((line) => visibleNow(line.id))
    .map((line) => ({ id: line.id, name: nameOf(line), photoUrl: line.photoUrl, charm: line.charm, frame: line.frame, body: line.body }))
    .sort(byName);
  // Someone whose only answers this viewer can't see (an owners-only item) doesn't sign for them.
  const wrote = new Set(rows.map((row) => row.membershipId));
  const signatures: IssueSignature[] = signerRows.flatMap((signer) => {
    const strokes = parseSignature(signer.signature);
    return strokes && wrote.has(signer.id) ? [{ id: signer.id, name: nameOf(signer), strokes }] : [];
  }).sort(byName);

  // Copied from a section: it keeps a section's look, exactly as it always read.
  const sectionRows = shown.filter((question) => question.fromSection);
  const blockRows = shown.filter((question) => !question.fromSection);

  const blocks: IssueBlock[] = blockRows.map((question) => {
    const format = formatOf(question);
    const answers = rows.filter((row) => row.issueQuestionId === question.id);
    return {
      questionId: question.id,
      question: question.text,
      suggestedBy: question.suggestedBy,
      poll:
        format === "poll"
          ? {
              multiple: question.pollMultiple,
              tally: delivered ? tallyPoll(question.pollOptions ?? [], answers.map((row) => row.pollChoices)) : null,
              voters: delivered ? answers.length : null,
            }
          : null,
      answers: answers.map((row) => {
        const { reactions: tally, comments: thread } = conversation(row);
        const card = row.linkUrl ? cardOf(row.linkUrl) : undefined;
        return {
          ...byline(row),
          body: row.body,
          photoUrl: row.photoUrl,
          audioUrl: row.audioUrl,
          audioDurationMs: row.audioDurationMs,
          choices: row.pollChoices.flatMap((index) => question.pollOptions?.[index] ?? []),
          addedLater: row.addedAfterDelivery,
          comments: thread,
          reactions: tally,
          ...(format === "music" && row.linkUrl
            ? {
                link: {
                  url: row.linkUrl,
                  provider: row.linkProvider,
                  title: card?.title ?? null,
                  artworkUrl: card?.artworkUrl ?? null,
                  tracks: card?.tracks ?? [],
                  trackCount: card?.trackCount ?? 0,
                },
              }
            : {}),
          ...(format === "photo_wall" ? { media: mediaByReply.get(row.replyId) ?? [] } : {}),
          ...stickerOf(row),
        };
      }),
      ...(format === "photo_wall" || format === "music" ? { format } : {}),
      ...(question.emoji ? { emoji: question.emoji } : {}),
      ...(question.description ? { description: question.description } : {}),
    };
  });

  const sections: IssueSectionBlock[] = sectionRows.map((question) => {
    const format = formatOf(question);
    return {
      id: question.id,
      kind: format === "photo_wall" || format === "music" ? format : "standard",
      title: question.text,
      emoji: question.emoji,
      description: question.description,
      replies: rows
        .filter((row) => row.issueQuestionId === question.id)
        .map((row) => {
          const card = row.linkUrl ? cardOf(row.linkUrl) : undefined;
          return {
            ...byline(row),
            body: row.body,
            linkUrl: row.linkUrl,
            linkProvider: row.linkProvider,
            linkTitle: card?.title ?? null,
            linkArtwork: card?.artworkUrl ?? null,
            linkTracks: card?.tracks ?? [],
            linkTrackCount: card?.trackCount ?? 0,
            addedLater: row.addedAfterDelivery,
            media: [...(row.photoUrl ? [{ url: row.photoUrl, caption: null }] : []), ...(mediaByReply.get(row.replyId) ?? [])],
            ...conversation(row),
            ...stickerOf(row),
          };
        }),
    };
  });

  return {
    issue,
    group,
    blocks,
    sections,
    answerCount: rows.length,
    comments: threads.top,
    commentsEnabled: group.commentsEnabled,
    mentionables: threads.mentionables,
    ...(statusLines.length > 0 ? { statusLines } : {}),
    ...(signatures.length > 0 ? { signatures } : {}),
  };
}

/** The loop an issue belongs to, or null: all a page needs before it knows who is reading. */
export async function issueGroupId(issueId: string): Promise<string | null> {
  if (!issueId) return null;
  const [row] = await db.select({ groupId: issues.groupId }).from(issues).where(eq(issues.id, issueId)).limit(1);
  return row?.groupId ?? null;
}

/**
 * The round a loop is taking answers for, and when it goes out: what a sign-off can
 * promise next. Nothing while the loop is paused, since nothing goes out then.
 */
export async function nextRoundFor(groupId: string): Promise<{ number: number; deliversAt: Date } | null> {
  const [row] = await db
    .select({ number: issues.number, deliversAt: issues.deliversAt })
    .from(issues)
    .innerJoin(groups, eq(groups.id, issues.groupId))
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open"), isNull(groups.pausedAt)))
    .limit(1);
  return row ?? null;
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

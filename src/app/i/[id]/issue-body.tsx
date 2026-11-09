"use client";

import Link from "next/link";
import { useEffect, useId, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { toggleReaction } from "./actions";
import { CommentThread } from "./comment-thread";
import { IssueBar } from "./issue-bar";
import { VoiceNote } from "@/components/voice-note";
import { formatAudioDuration } from "@/lib/audio-validation";
import type { IssueComment } from "@/lib/comment-view";
import type { IssueAnswer, IssueBlock, IssuePoll, IssueSectionBlock, IssueSectionReplyBlock } from "@/lib/issue-view";
import type { PersonGroup } from "@/lib/issue-reading";
import { Avatar, NameCharm } from "@/components/avatar";
import { EmojiPicker } from "@/components/emoji-picker";
import { MusicCard } from "@/components/music-card";
import { PhotoLightbox, useLightbox, type LightboxPhoto } from "@/components/photo-lightbox";
import { Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";

type Props = {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  blocks: IssueBlock[];
  sections: IssueSectionBlock[];
  comments: IssueComment[];
  /** The owner's switch: false removes every comment surface from the page. */
  commentsEnabled: boolean;
  mentionables: Array<{ id: string; name: string }>;
  /** Reading by person: one card per author, replacing the question-by-question layout. */
  groups?: PersonGroup[] | null;
  /** The viewer's own reply sheet, while it can still change this round. */
  editHref?: string | null;
  /** Who to read and in what order, opened from the bar. Absent when there is no choice. */
  reading?: ReactNode;
  readingLabel?: string;
  /** Says when the page is showing less than everything. */
  readingNote?: ReactNode;
  /** Keeps the name of what you're reading in view on the bar. */
  barTitle?: string;
  /** The owner's sign-off, closing the round before the talk about it. */
  closing?: ReactNode;
};

export function IssueBody({
  issueId,
  viewerToken,
  canInteract,
  blocks,
  sections,
  comments,
  commentsEnabled,
  mentionables,
  groups = null,
  editHref = null,
  reading,
  readingLabel,
  readingNote,
  barTitle,
  closing,
}: Props) {
  const answered = blocks.filter((block) => block.answers.length > 0);
  const talk: Conversation = { issueId, viewerToken, canInteract, commentsEnabled, mentionables };
  const sectionOffset = answered.length;
  // Reading by person, an answer still carries its question's number from the by-question view.
  const numberOf = new Map(answered.map((block, index) => [block.question, index + 1]));
  // The contents: every card on the page, numbered as the cards are.
  const contents: Array<{ href: string; number: number | null; label: string }> = groups
    ? groups.map((group) => ({ href: `#person-${group.id}`, number: null, label: group.name }))
    : [
        ...answered.map((block, index) => ({ href: `#question-${block.questionId}`, number: index + 1, label: block.question })),
        ...sections.map((section, index) => ({
          href: `#section-${section.id}`,
          number: sectionOffset + 1 + index,
          label: `${section.emoji ? `${section.emoji} ` : ""}${section.title}`,
        })),
      ];
  // One way back to the sheet, beside the viewer's first answer on the page.
  const firstOwn = editHref
    ? (groups
        ? groups.flatMap((group) => group.entries.flatMap((entry) => (entry.kind === "answer" ? [entry.answer] : [])))
        : answered.flatMap((block) => block.answers)
      ).find((answer) => answer.isYou)?.replyId ?? null
    : null;
  return (
    <div className="mt-3 flex flex-col gap-6">
      <IssueBar contents={contents} reading={reading} readingLabel={readingLabel} title={barTitle} />
      {readingNote}

      {groups
        ? groups.map((group, index) => (
            <section key={group.id} id={`person-${group.id}`} aria-label={group.name} data-paper="answer" className="card paper ride-in scroll-mt-20 p-5 pt-7">
              <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
              <h2 className="issue-question flex items-center gap-3 text-ink">
                <span aria-hidden="true"><Avatar name={group.name} photoUrl={group.photoUrl} frame={group.frame} /></span>
                {group.name}
                <NameCharm charm={group.charm} />
              </h2>
              <div className="mt-3">
                {group.entries.map((entry) =>
                  entry.kind === "answer" ? (
                    <AnswerCard
                      key={entry.answer.replyId}
                      issueId={issueId}
                      viewerToken={viewerToken}
                      canInteract={canInteract}
                      answer={entry.answer}
                      commentsEnabled={commentsEnabled}
                      mentionables={mentionables}
                      questionLabel={entry.question}
                      questionNumber={numberOf.get(entry.question)}
                      editHref={entry.answer.replyId === firstOwn ? editHref : null}
                    />
                  ) : (
                    <SectionReplyCard
                      key={entry.reply.replyId}
                      reply={entry.reply}
                      label={`${entry.emoji ? `${entry.emoji} ` : ""}${entry.title}`}
                      talk={talk}
                    />
                  ),
                )}
              </div>
            </section>
          ))
        : null}

      {groups ? null : blocks
        .filter((block) => block.answers.length > 0)
        .map((block, index) => (
          <section key={block.questionId} id={`question-${block.questionId}`} data-paper={block.poll ? "poll" : "answer"} className="card paper ride-in scroll-mt-20 p-5 pt-7">
            <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
            <h2 className="issue-question flex items-start gap-3 text-ink">
              <span className="question-number mt-0.5 numeric">{index + 1}</span>
              {block.emoji ? <span className="mr-1">{block.emoji}</span> : null}
              {block.question}
            </h2>
            {block.description ? (
              <p className="mt-1.5 pl-8 text-[13px] leading-relaxed text-ink-muted">{block.description}</p>
            ) : null}
            {block.suggestedBy ? (
              <p className="mt-1.5 pl-8 text-[13px] font-medium text-ink-muted">
                {text(copy.issue.askedBy, { name: block.suggestedBy })}
              </p>
            ) : null}

            {block.poll?.tally ? <PollResults poll={block.poll} /> : null}

            <div className="mt-3">
              {block.format === "photo_wall" ? (
                <PhotoWall
                  title={block.question}
                  entries={block.answers.map((answer) => ({ reply: answer, media: answer.media ?? [], anchor: `answer-${answer.replyId}` }))}
                  talk={talk}
                  number={index + 1}
                />
              ) : block.answers.map((answer) => (
                <AnswerCard
                  key={answer.replyId}
                  issueId={issueId}
                  viewerToken={viewerToken}
                  canInteract={canInteract}
                  answer={answer}
                  commentsEnabled={commentsEnabled}
                  mentionables={mentionables}
                  questionNumber={index + 1}
                  editHref={answer.replyId === firstOwn ? editHref : null}
                />
              ))}
            </div>
          </section>
        ))}

      {groups ? null : sections.map((section, sectionIndex) => (
        <section key={section.id} id={`section-${section.id}`} data-paper="note" className="card paper ride-in scroll-mt-20 p-5 pt-7">
          <Tape tone={(["mint", "check", "dots", "stripe"] as const)[sectionIndex % 4]} position="left" />
          <h2 className="issue-question flex items-start gap-3 text-ink">
            <span className="question-number mt-0.5 numeric">{sectionOffset + 1 + sectionIndex}</span>
            {section.emoji ? <span className="mr-1">{section.emoji}</span> : null}
            {section.title}
          </h2>
          {section.description ? (
            <p className="mt-1.5 pl-8 text-[13px] leading-relaxed text-ink-muted">{section.description}</p>
          ) : null}
          <div className="mt-3">
            {section.kind === "photo_wall" ? (
              <PhotoWall
                title={section.title}
                entries={section.replies.map((reply) => ({ reply, media: reply.media, anchor: `section-reply-${reply.replyId}` }))}
                talk={talk}
                number={sectionOffset + 1 + sectionIndex}
              />
            ) : (
              section.replies.map((reply) => (
                <SectionReplyCard key={reply.replyId} reply={reply} talk={talk} number={sectionOffset + 1 + sectionIndex} />
              ))
            )}
            {section.replies.length === 0 ? (
              <p className="mt-2 text-[13.5px] text-ink-muted">{copy.issue.sectionEmpty}</p>
            ) : null}
          </div>
        </section>
      ))}

      {closing}

      {commentsEnabled ? (
        <section className="card mt-2 p-5">
          <h2 className="text-ink">{copy.issue.comments}</h2>
          <CommentThread
            issueId={issueId}
            viewerToken={viewerToken}
            replyId={null}
            comments={comments}
            mentionables={mentionables}
            canInteract={canInteract}
            composerLabel={copy.issue.commentAriaLabel}
            placeholder={copy.issue.commentPlaceholder}
            empty={copy.issue.noComments}
          />
        </section>
      ) : null}
    </div>
  );
}

type WallEntry = {
  reply: Reactable & { authorPhotoUrl: string | null; authorFrame: string | null; authorCharm: string | null };
  media: Array<{ url: string; caption: string | null }>;
  /** Where the Album's "view in issue" lands for this person's photos. */
  anchor: string;
};

/**
 * A photo wall laid edge to edge; tapping a photo opens it full size, with a
 * download. Under it, each person who added photos has their own reactions and
 * thread.
 */
function PhotoWall({ title, entries, talk, number }: { title: string; entries: WallEntry[]; talk: Conversation; number: number }) {
  const lightbox = useLightbox();
  const tiles = entries.flatMap((entry) =>
    entry.media.map((item, mediaIndex) => ({ entry, item, first: mediaIndex === 0 })),
  );
  const photos: LightboxPhoto[] = tiles.map(({ entry, item }) => ({
    url: item.url,
    author: entry.reply.author,
    caption: item.caption,
    context: title,
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ entry, item, first }, index) => (
          <figure key={item.url} id={first ? entry.anchor : undefined} className="m-0 scroll-mt-4">
            <button
              type="button"
              className="photo-wall-tile"
              aria-label={text(copy.album.openPhoto, { author: entry.reply.author, about: item.caption || title })}
              onClick={(event) => lightbox.open(index, event.currentTarget)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt="" loading="lazy" decoding="async" className="w-full rounded-lg border border-line object-cover" />
            </button>
            <figcaption className="mt-1 text-[12.5px] leading-snug text-ink-soft">
              <span className="font-bold">{entry.reply.author}</span>
              {item.caption ? `, ${item.caption}` : null}
            </figcaption>
          </figure>
        ))}
      </div>
      <PhotoLightbox photos={photos} state={lightbox} />
      {/* A read-only copy shows a row only where someone has reacted or commented. */}
      {entries.filter((entry) => talk.canInteract || entry.reply.comments.length > 0 || entry.reply.reactions.some((reaction) => reaction.count > 0)).map((entry) => (
        <div key={entry.reply.replyId} className="divided mt-4 border-t border-line pt-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={entry.reply.author} photoUrl={entry.reply.authorPhotoUrl} frame={entry.reply.authorFrame} />
            <p className="m-0 text-[14px] font-extrabold text-ink-soft">{entry.reply.author}</p>
            <NameCharm charm={entry.reply.authorCharm} />
          </div>
          <AnswerActions {...talk} answer={entry.reply} questionNumber={number} />
        </div>
      ))}
    </>
  );
}

/** One person's answer to a standard or music section, with its link card, photos, reactions and thread. */
function SectionReplyCard({ reply, label, talk, number }: { reply: IssueSectionReplyBlock; label?: string; talk: Conversation; number?: number }) {
  return (
    <div id={`section-reply-${reply.replyId}`} className="divided mt-4 scroll-mt-4 border-t border-line pt-4 first:border-t-0">
      {label ? (
        <h3 className="m-0 text-[22px] leading-tight text-ink">{label}</h3>
      ) : (
        <div className="flex items-center gap-2.5">
          <Avatar name={reply.author} photoUrl={reply.authorPhotoUrl} frame={reply.authorFrame} />
          <p className="m-0 text-[14px] font-extrabold text-ink-soft">{reply.author}</p>
          <NameCharm charm={reply.authorCharm} />
        </div>
      )}
      {reply.body ? (
        <p className="answer-text mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{reply.body}</p>
      ) : null}
      {reply.linkUrl ? (
        <MusicCard
          url={reply.linkUrl}
          provider={reply.linkProvider}
          title={reply.linkTitle}
          artworkUrl={reply.linkArtwork}
          tracks={reply.linkTracks}
          trackCount={reply.linkTrackCount}
        />
      ) : null}
      {reply.media.map((item) => (
        <figure key={item.url} className="m-0 mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.caption || text(copy.issue.photoAlt, { author: reply.author })} loading="lazy" decoding="async" className="w-full rounded-lg border border-line object-cover" />
          {item.caption && label ? (
            <figcaption className="mt-1 text-[12.5px] leading-snug text-ink-soft">{item.caption}</figcaption>
          ) : null}
        </figure>
      ))}
      {reply.addedLater ? (
        <p className="mt-2 text-[13px] text-ink-muted">{copy.issue.addedLater}</p>
      ) : null}
      <AnswerActions {...talk} answer={reply} questionNumber={number} />
    </div>
  );
}

/** Back to the viewer's own reply sheet, beside their name. */
function EditLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="ml-auto inline-flex min-h-11 items-center text-[13px] font-bold text-accent-ink underline decoration-line-strong underline-offset-4"
    >
      {copy.issue.editYourAnswers}
    </Link>
  );
}

/** The quiet tally under a delivered poll: each option, how many picked it, a thin bar. */
function PollResults({ poll }: { poll: IssuePoll }) {
  const voters = poll.voters ?? 0;
  return (
    <div className="mt-3 pl-8">
      <p className="text-[12.5px] font-bold text-ink-muted numeric">
        {copy.polls.issue.results} · {voters === 1 ? copy.polls.issue.votesOne : text(copy.polls.issue.votesMany, { count: voters })}
      </p>
      <ul className="mt-2 flex flex-col gap-2" aria-label={copy.polls.issue.results}>
        {(poll.tally ?? []).map((row) => (
          <li key={row.option}>
            <div className="flex items-baseline justify-between gap-3 text-[14px] text-ink">
              <span className="min-w-0">{row.option}</span>
              <span className="flex-none font-bold text-ink-soft numeric">{row.votes}</span>
            </div>
            <div className="poll-bar mt-1" aria-hidden="true">
              <span style={{ width: `${voters > 0 ? Math.round((row.votes / voters) * 100) : 0}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Conversation = {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  commentsEnabled: boolean;
  mentionables: Array<{ id: string; name: string }>;
};

/** What every answer carries, whatever it holds: reactions, and its own comment thread. */
type Reactable = {
  replyId: string;
  author: string;
  isYou: boolean;
  reactions: IssueAnswer["reactions"];
  comments: IssueComment[];
};

function AnswerCard({
  issueId,
  viewerToken,
  canInteract,
  answer,
  commentsEnabled,
  mentionables,
  questionLabel,
  questionNumber,
  editHref = null,
}: Conversation & {
  answer: IssueAnswer;
  /** Set when reading by person, where the question is no longer the heading above. */
  questionLabel?: string;
  /** The question's number on the page, so each reaction button's name says which answer it's for. */
  questionNumber?: number;
  /** Set on the viewer's own answer while it can still change. */
  editHref?: string | null;
}) {
  return (
    <article id={`answer-${answer.replyId}`} className="answer-card divided mt-4 scroll-mt-4 border-t border-line pt-4 first:border-t-0">
      {questionLabel ? (
        // Reading by person: the card is already theirs, so the question leads and the byline would only repeat.
        <h3 className="m-0 text-[22px] leading-tight text-ink">{questionLabel}</h3>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5">
          <Avatar name={answer.author} photoUrl={answer.authorPhotoUrl} frame={answer.authorFrame} />
          <p className="m-0 text-[14px] font-extrabold text-ink-soft">{answer.author}</p>
          <NameCharm charm={answer.authorCharm} />
          {editHref ? <EditLink href={editHref} /> : null}
        </div>
      )}
      {questionLabel && editHref ? <EditLink href={editHref} /> : null}
      {answer.choices.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={text(copy.polls.issue.chose, { choices: answer.choices.join(", ") })}>
          {answer.choices.map((choice) => (
            <li key={choice} className="chip border bg-accent-soft px-2.5 py-1 text-[13px] font-bold text-accent-ink">{choice}</li>
          ))}
        </ul>
      ) : answer.body || !(answer.link || answer.media) ? (
        <p className="answer-text mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
          {answer.body}
        </p>
      ) : null}
      {answer.link ? (
        <MusicCard
          url={answer.link.url}
          provider={answer.link.provider}
          title={answer.link.title}
          artworkUrl={answer.link.artworkUrl}
          tracks={answer.link.tracks}
          trackCount={answer.link.trackCount}
        />
      ) : null}
      {(answer.media ?? []).map((item) => (
        <figure key={item.url} className="m-0 mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.caption || text(copy.issue.photoAlt, { author: answer.author })} loading="lazy" decoding="async" className="w-full rounded-lg border border-line object-cover" />
          {item.caption ? <figcaption className="mt-1 text-[12.5px] leading-snug text-ink-soft">{item.caption}</figcaption> : null}
        </figure>
      ))}
      {answer.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={answer.photoUrl}
          alt={text(copy.issue.photoAlt, { author: answer.author })}
          // Below the fold on all but the first answer, and photos are camera-sized.
          loading="lazy"
          decoding="async"
          className="mt-3 w-full rounded-lg border border-line object-cover"
        />
      ) : null}
      {answer.audioUrl ? (
        <VoiceNote
          className="mt-3"
          src={answer.audioUrl}
          durationMs={answer.audioDurationMs}
          label={text(copy.issue.voiceLabel, { duration: formatAudioDuration(answer.audioDurationMs ?? 0) })}
          playLabel={text(copy.voiceNote.play, { author: answer.author })}
        />
      ) : null}
      {answer.addedLater ? (
        <p className="mt-2 text-[13px] text-ink-muted">
          {copy.issue.addedLater}
        </p>
      ) : null}

      <AnswerActions
        issueId={issueId}
        viewerToken={viewerToken}
        canInteract={canInteract}
        commentsEnabled={commentsEnabled}
        mentionables={mentionables}
        answer={answer}
        questionNumber={questionNumber}
      />
    </article>
  );
}

/** Reactions and the comment thread under one answer. */
function AnswerActions({
  issueId,
  viewerToken,
  canInteract,
  answer,
  commentsEnabled,
  mentionables,
  questionNumber,
}: Conversation & { answer: Reactable; questionNumber?: number }) {
  const [pending, startTransition] = useTransition();
  const [threadOpen, setThreadOpen] = useState(false);
  const [reactFailed, setReactFailed] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Once the connection is back, the message no longer applies.
  useEffect(() => {
    if (!reactFailed) return;
    const clear = () => setReactFailed(null);
    window.addEventListener("online", clear);
    return () => window.removeEventListener("online", clear);
  }, [reactFailed]);
  const threadId = useId();
  const owner = answer.isYou ? copy.issue.ownerYour : text(copy.issue.ownerOther, { author: answer.author });
  const count = answer.comments.length;
  const [local, addLocal] = useOptimistic(
    answer.reactions,
    (state, emoji: string) =>
      state.some((reaction) => reaction.emoji === emoji)
        ? state.map((reaction) =>
            reaction.emoji === emoji
              ? {
                  ...reaction,
                  mine: !reaction.mine,
                  count: reaction.count + (reaction.mine ? -1 : 1),
                }
              : reaction,
          )
        : [...state, { emoji, count: 1, mine: true }],
  );
  const whose = questionNumber
    ? answer.isYou ? text(copy.issue.yourAnswerNumbered, { number: questionNumber }) : text(copy.issue.whoseAnswerNumbered, { author: answer.author, number: questionNumber })
    : answer.isYou ? copy.issue.yourAnswer : text(copy.issue.whoseAnswer, { author: answer.author });
  const commentLabel = count === 0
    ? copy.issue.commentOnAnswer
    : count === 1
      ? copy.issue.commentCountOne
      : text(copy.issue.commentCount, { count });
  const addLabel = questionNumber ? text(copy.issue.reactMoreTo, { whose }) : answer.isYou ? copy.issue.reactMoreOwn : text(copy.issue.reactMore, { author: answer.author });

  function react(emoji: string) {
    if (pending) return;
    setReactFailed(null);
    startTransition(async () => {
      addLocal(emoji);
      try {
        const result = await toggleReaction({ issueId, replyId: answer.replyId, emoji, viewerToken });
        // Refused: the optimistic tap springs back, and this says why.
        if (!result.ok) setReactFailed(result.error ?? copy.issue.reactFailed);
      } catch {
        // Offline: the same, with the connection named.
        setReactFailed(copy.issue.reactFailed);
      }
    });
  }

  return (
    <>
      <div className="answer-actions">
        {/* Reactions wrap within their own row; Comment keeps its place at the right, however many there are. */}
        <div className="reaction-row">
        {/* Untouched quick picks would repeat under every answer: only the heart stays one tap away until someone reacts; the picker has the rest. */}
        {local.filter((reaction) => reaction.count > 0 || reaction.mine || reaction.emoji === "❤️").map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canInteract}
            // aria-disabled, not disabled, while a toggle is in flight: the pressed button keeps keyboard focus.
            aria-disabled={pending ? true : undefined}
            aria-pressed={reaction.mine}
            aria-label={
              reaction.count > 0
                ? text(copy.issue.reactWithCountTo, { emoji: reaction.emoji, count: reaction.count, whose })
                : text(copy.issue.reactAriaLabelTo, { emoji: reaction.emoji, whose })
            }
            onClick={() => react(reaction.emoji)}
            // Read-only (a shared copy) stays at full contrast: the counts are content there, not a control.
            className={`reaction-chip ${canInteract ? "disabled:opacity-50" : "reaction-chip--static"} ${reaction.count === 0 && !reaction.mine ? "reaction-chip--idle" : ""} aria-disabled:opacity-50 ${
              reaction.mine
                ? "reaction-chip--mine"
                : "hover:bg-field"
            }`}
          >
            <span className={reaction.mine ? "reaction-selected" : ""} aria-hidden>{reaction.emoji}</span>
            {/* Always there, so a first reaction moves nothing beside it. */}
            <span key={reaction.count} className="reaction-count-slot numeric">{reaction.count > 0 ? reaction.count : ""}</span>
          </button>
        ))}
        {canInteract ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label={addLabel}
            onClick={() => setPicking(true)}
            className="reaction-chip reaction-chip--add hover:bg-field"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12.8A8.5 8.5 0 1 1 11.2 3.5" />
              <path d="M8.5 14.5c1.7 2 5 2 6.7 0" />
              <path d="M9 9.5h.01M14.5 9.5h.01" strokeWidth="2.6" />
              <path d="M19 2.5v6M16 5.5h6" />
            </svg>
          </button>
        ) : null}
        </div>
        {commentsEnabled && (count > 0 || canInteract) ? (
          <button
            type="button"
            aria-expanded={threadOpen}
            aria-controls={threadId}
            onClick={() => setThreadOpen((open) => !open)}
            className="link cursor-pointer"
            aria-label={text(copy.issue.commentButtonNamed, { label: commentLabel, whose })}
          >
            {commentLabel}
          </button>
        ) : null}
      </div>

      {reactFailed ? <p role="alert" className="action-failed">{reactFailed}</p> : null}
      {picking ? (
        <EmojiPicker
          label={addLabel}
          onClose={() => setPicking(false)}
          onPick={(emoji) => {
            setPicking(false);
            // Picking one you've already used keeps it; only its chip takes it back.
            if (!local.some((reaction) => reaction.emoji === emoji && reaction.mine)) react(emoji);
          }}
        />
      ) : null}

      {threadOpen && commentsEnabled ? (
        <div className="mt-1">
            <div id={threadId} role="group" aria-label={text(copy.issue.threadLabel, { owner })} className="mt-1">
              <CommentThread
                issueId={issueId}
                viewerToken={viewerToken}
                replyId={answer.replyId}
                comments={answer.comments}
                mentionables={mentionables}
                canInteract={canInteract}
                composerLabel={text(copy.issue.threadComposerLabel, { owner })}
                placeholder={copy.issue.commentPlaceholder}
                focusComposer
              />
            </div>
        </div>
      ) : null}
    </>
  );
}

"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { toggleReaction } from "./actions";
import { CommentThread } from "./comment-thread";
import { formatAudioDuration } from "@/lib/audio-validation";
import type { IssueComment } from "@/lib/comment-view";
import type { IssueAnswer, IssueBlock, IssuePoll, IssueSectionBlock, IssueSectionReplyBlock } from "@/lib/issue-view";
import type { PersonGroup } from "@/lib/issue-reading";
import { Avatar } from "@/components/avatar";
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
}: Props) {
  const sectionOffset = blocks.filter((block) => block.answers.length > 0).length;
  return (
    <div className="mt-8 flex flex-col gap-7">
      {groups
        ? groups.map((group, index) => (
            <section key={group.id} aria-label={group.name} className="card paper ride-in p-5 pt-7">
              <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
              <h2 className="issue-question flex items-center gap-3 text-ink">
                <span aria-hidden="true"><Avatar name={group.name} photoUrl={group.photoUrl} /></span>
                {group.name}
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
                    />
                  ) : (
                    <SectionReplyCard
                      key={entry.reply.replyId}
                      reply={entry.reply}
                      label={`${entry.emoji ? `${entry.emoji} ` : ""}${entry.title}`}
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
          <section key={block.questionId} className="card paper ride-in p-5 pt-7">
            <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
            <h2 className="issue-question flex items-start gap-3 text-ink">
              <span className="question-number mt-0.5 numeric">{index + 1}</span>
              {block.question}
            </h2>
            {block.suggestedBy ? (
              <p className="mt-1.5 pl-8 text-[13px] font-medium text-ink-muted">
                {text(copy.issue.askedBy, { name: block.suggestedBy })}
              </p>
            ) : null}

            {block.poll?.tally ? <PollResults poll={block.poll} /> : null}

            <div className="mt-3">
              {block.answers.map((answer) => (
                <AnswerCard
                  key={answer.replyId}
                  issueId={issueId}
                  viewerToken={viewerToken}
                  canInteract={canInteract}
                  answer={answer}
                  commentsEnabled={commentsEnabled}
                  mentionables={mentionables}
                />
              ))}
            </div>
          </section>
        ))}

      {groups ? null : sections.map((section, sectionIndex) => (
        <section key={section.id} className="card paper ride-in p-5 pt-7">
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
              <PhotoWall section={section} />
            ) : (
              section.replies.map((reply) => <SectionReplyCard key={reply.replyId} reply={reply} />)
            )}
            {section.replies.length === 0 ? (
              <p className="mt-2 text-[13.5px] text-ink-muted">{copy.issue.sectionEmpty}</p>
            ) : null}
          </div>
        </section>
      ))}

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

/** A photo wall laid edge to edge; tapping a photo opens it full size, with a download. */
function PhotoWall({ section }: { section: IssueSectionBlock }) {
  const lightbox = useLightbox();
  const tiles = section.replies.flatMap((reply) =>
    reply.media.map((item, mediaIndex) => ({ reply, item, first: mediaIndex === 0 })),
  );
  const photos: LightboxPhoto[] = tiles.map(({ reply, item }) => ({
    url: item.url,
    author: reply.author,
    caption: item.caption,
    context: section.title,
  }));

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {tiles.map(({ reply, item, first }, index) => (
          <figure key={item.url} id={first ? `section-reply-${reply.replyId}` : undefined} className="m-0 scroll-mt-4">
            <button
              type="button"
              className="photo-wall-tile"
              aria-label={text(copy.album.openPhoto, { author: reply.author, about: item.caption || section.title })}
              onClick={(event) => lightbox.open(index, event.currentTarget)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt="" className="w-full rounded-lg border border-line object-cover" />
            </button>
            {item.caption ? (
              <figcaption className="mt-1 text-[12.5px] leading-snug text-ink-soft">
                <span className="font-bold">{reply.author}</span> — {item.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
      <PhotoLightbox photos={photos} state={lightbox} />
    </>
  );
}

/** One person's answer to a standard or music section, with its link card and photos. */
function SectionReplyCard({ reply, label }: { reply: IssueSectionReplyBlock; label?: string }) {
  return (
    <div id={`section-reply-${reply.replyId}`} className="mt-4 scroll-mt-4 border-t border-line pt-4 first:border-t-0">
      {label ? <h3 className="m-0 text-[15px] font-bold text-ink">{label}</h3> : null}
      <div className={`flex items-center gap-2.5${label ? " mt-2" : ""}`}>
        <Avatar name={reply.author} photoUrl={reply.authorPhotoUrl} />
        <p className="m-0 text-[14px] font-extrabold text-ink-soft">{reply.author}</p>
      </div>
      {reply.body ? (
        <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{reply.body}</p>
      ) : null}
      {reply.linkUrl ? (
        <a
          href={reply.linkUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-accent-soft p-3 text-ink no-underline"
        >
          {reply.linkArtwork ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={reply.linkArtwork} alt="" className="h-12 w-12 flex-none rounded-md object-cover" />
          ) : (
            <span aria-hidden="true" className="font-display text-[24px] leading-none">&#9836;</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold">{reply.linkTitle ?? reply.linkUrl}</span>
            <span className="block text-[12px] font-medium text-ink-soft capitalize">{reply.linkProvider}</span>
          </span>
        </a>
      ) : null}
      {reply.media.map((item) => (
        <figure key={item.url} className="m-0 mt-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.url} alt={item.caption ?? ""} className="w-full rounded-lg border border-line object-cover" />
          {item.caption && label ? (
            <figcaption className="mt-1 text-[12.5px] leading-snug text-ink-soft">{item.caption}</figcaption>
          ) : null}
        </figure>
      ))}
      {reply.addedLater ? (
        <p className="mt-2 text-[12px] text-ink-muted">{copy.issue.addedLater}</p>
      ) : null}
    </div>
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

function AnswerCard({
  issueId,
  viewerToken,
  canInteract,
  answer,
  commentsEnabled,
  mentionables,
  questionLabel,
}: {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  answer: IssueAnswer;
  commentsEnabled: boolean;
  mentionables: Array<{ id: string; name: string }>;
  /** Set when reading by person, where the question is no longer the heading above. */
  questionLabel?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [threadOpen, setThreadOpen] = useState(false);
  const threadId = useId();
  const owner = answer.isYou ? copy.issue.ownerYour : text(copy.issue.ownerOther, { author: answer.author });
  const count = answer.comments.length;
  const [local, addLocal] = useOptimistic(
    answer.reactions,
    (state, emoji: string) =>
      state.map((reaction) =>
        reaction.emoji === emoji
          ? {
              ...reaction,
              mine: !reaction.mine,
              count: reaction.count + (reaction.mine ? -1 : 1),
            }
          : reaction,
      ),
  );

  return (
    <article id={`answer-${answer.replyId}`} className="answer-card mt-4 scroll-mt-4 border-t border-line pt-4 first:border-t-0">
      {questionLabel ? <h3 className="m-0 mb-2 text-[15px] font-bold text-ink">{questionLabel}</h3> : null}
      <div className="flex items-center gap-2.5">
        <Avatar name={answer.author} photoUrl={answer.authorPhotoUrl} />
        <p className="m-0 text-[14px] font-extrabold text-ink-soft">{answer.author}</p>
      </div>
      {answer.choices.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={text(copy.polls.issue.chose, { choices: answer.choices.join(", ") })}>
          {answer.choices.map((choice) => (
            <li key={choice} className="chip border bg-accent-soft px-2.5 py-1 text-[13px] font-bold text-accent-ink">{choice}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
          {answer.body}
        </p>
      )}
      {answer.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={answer.photoUrl}
          alt={answer.body || text(copy.issue.photoAlt, { author: answer.author })}
          className="mt-3 w-full rounded-lg border border-line object-cover"
        />
      ) : null}
      {answer.audioUrl ? (
        <figure className="mt-3">
          <audio
            controls
            preload="none"
            src={answer.audioUrl}
            aria-label={text(copy.issue.voiceLabel, { duration: formatAudioDuration(answer.audioDurationMs ?? 0) })}
            className="w-full"
          />
          <figcaption className="mt-1 text-[12px] text-ink-muted numeric">
            {text(copy.issue.voiceLabel, { duration: formatAudioDuration(answer.audioDurationMs ?? 0) })}
          </figcaption>
        </figure>
      ) : null}
      {answer.addedLater ? (
        <p className="mt-2 text-[12px] text-ink-muted">
          {copy.issue.addedLater}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {local.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canInteract || pending}
            aria-pressed={reaction.mine}
            aria-label={text(copy.issue.reactAriaLabel, { emoji: reaction.emoji })}
            onClick={() =>
              startTransition(async () => {
                addLocal(reaction.emoji);
                await toggleReaction({
                  issueId,
                  replyId: answer.replyId,
                  emoji: reaction.emoji,
                  viewerToken,
                });
              })
            }
            className={`reaction-chip flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-transform disabled:opacity-50 ${
              reaction.mine
                ? "border-accent-line bg-accent-soft text-accent-ink"
                : "border-line text-ink-soft hover:bg-field"
            }`}
          >
            <span className={reaction.mine ? "reaction-selected" : ""} aria-hidden>{reaction.emoji}</span>
            {reaction.count > 0 ? (
              <span key={reaction.count} className="reaction-count numeric">{reaction.count}</span>
            ) : null}
          </button>
        ))}
      </div>

      {commentsEnabled && (count > 0 || canInteract) ? (
        <div className="mt-2">
          <button
            type="button"
            aria-expanded={threadOpen}
            aria-controls={threadId}
            onClick={() => setThreadOpen((open) => !open)}
            className="min-h-8 rounded-md px-1 text-[13px] font-bold text-accent-ink underline decoration-line-strong underline-offset-4"
          >
            {count === 0
              ? copy.issue.commentOnAnswer
              : count === 1
                ? copy.issue.commentCountOne
                : text(copy.issue.commentCount, { count })}
          </button>
          {threadOpen ? (
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
                empty={copy.issue.threadEmpty}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

"use client";

import { useOptimistic, useState, useTransition } from "react";
import { addComment, toggleReaction } from "./actions";
import { formatAudioDuration } from "@/lib/audio-validation";
import type { IssueAnswer, IssueBlock } from "@/lib/issue-view";
import { Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";

type Comment = { id: string; author: string; body: string };

type Props = {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  blocks: IssueBlock[];
  comments: Comment[];
};

export function IssueBody({
  issueId,
  viewerToken,
  canInteract,
  blocks,
  comments,
}: Props) {
  return (
    <div className="mt-8 flex flex-col gap-7">
      {blocks
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

            <div className="mt-3">
              {block.answers.map((answer) => (
                <AnswerCard
                  key={answer.replyId}
                  issueId={issueId}
                  viewerToken={viewerToken}
                  canInteract={canInteract}
                  answer={answer}
                />
              ))}
            </div>
          </section>
        ))}

      <section className="card mt-2 p-5">
        <h2 className="text-ink">{copy.issue.comments}</h2>
        {comments.length > 0 ? (
          <div className="mt-3 divide-y divide-line border-t border-line">
            {comments.map((comment) => (
              <div key={comment.id} className="px-4 py-3">
                <p className="text-[13px] font-medium text-ink-soft">
                  {comment.author}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
                  {comment.body}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-ink-muted">{copy.issue.noComments}</p>
        )}

        {canInteract ? (
          <CommentForm issueId={issueId} viewerToken={viewerToken} />
        ) : null}
      </section>
    </div>
  );
}

function AnswerCard({
  issueId,
  viewerToken,
  canInteract,
  answer,
}: {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  answer: IssueAnswer;
}) {
  const [pending, startTransition] = useTransition();
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
    <article className="answer-card mt-4 border-t border-line pt-4 first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span className="avatar" aria-hidden="true">{answer.author.charAt(0)}</span>
        <p className="m-0 text-[14px] font-extrabold text-ink-soft">{answer.author}</p>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
        {answer.body}
      </p>
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
    </article>
  );
}

function CommentForm({
  issueId,
  viewerToken,
}: {
  issueId: string;
  viewerToken: string | null;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const body = value.trim();
    if (!body) {
      setError(copy.issue.writeFirst);
      return;
    }
    startTransition(async () => {
      const result = await addComment({ issueId, body, viewerToken });
      if (result.ok) {
        setValue("");
        setError(null);
      } else {
        setError(result.error ?? copy.issue.postError);
      }
    });
  };

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={2}
        placeholder={copy.issue.commentPlaceholder}
        aria-label={copy.issue.commentAriaLabel}
        className="field"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          role={error ? "alert" : undefined}
          className="text-[13px] text-danger"
        >
          {error}
        </p>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? copy.issue.posting : copy.issue.post}
        </button>
      </div>
    </form>
  );
}

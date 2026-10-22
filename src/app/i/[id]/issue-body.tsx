"use client";

import { useOptimistic, useState, useTransition } from "react";
import { addComment, toggleReaction } from "./actions";
import type { IssueAnswer, IssueBlock } from "@/lib/issue-view";

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
    <div className="mt-6 flex flex-col gap-5">
      {blocks
        .filter((block) => block.answers.length > 0)
        .map((block, index) => (
          <section key={block.questionId}>
            <h2 className="flex items-start gap-3 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">
              <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-field text-[11px] font-semibold text-ink-muted numeric">
                {index + 1}
              </span>
              {block.question}
            </h2>

            <div className="mt-2.5 flex flex-col gap-2.5">
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

      <section className="mt-2">
        <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
          Comments
        </h2>
        {comments.length > 0 ? (
          <div className="card mt-2.5 divide-y divide-line">
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
          <p className="mt-2 text-[14px] text-ink-muted">Nothing yet.</p>
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
    <article className="card p-4">
      <p className="text-[13px] font-medium text-ink-soft">{answer.author}</p>
      <p className="mt-1 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">
        {answer.body}
      </p>
      {answer.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={answer.photoUrl}
          alt=""
          className="mt-3 w-full rounded-lg border border-line object-cover"
        />
      ) : null}
      {answer.addedLater ? (
        <p className="mt-2 text-[12px] text-ink-muted">
          added after the round went out
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {local.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canInteract || pending}
            aria-pressed={reaction.mine}
            aria-label={`React with ${reaction.emoji}`}
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
            className={`flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors disabled:opacity-50 ${
              reaction.mine
                ? "border-accent-line bg-accent-soft text-accent-ink"
                : "border-line text-ink-soft hover:bg-field"
            }`}
          >
            <span aria-hidden>{reaction.emoji}</span>
            {reaction.count > 0 ? (
              <span className="numeric">{reaction.count}</span>
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
      setError("Write something first.");
      return;
    }
    startTransition(async () => {
      const result = await addComment({ issueId, body, viewerToken });
      if (result.ok) {
        setValue("");
        setError(null);
      } else {
        setError(result.error ?? "Could not post that.");
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
        placeholder="Say something nice."
        aria-label="Comment"
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
          {pending ? "Posting…" : "Post"}
        </button>
      </div>
    </form>
  );
}

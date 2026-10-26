"use client";

/* eslint-disable @next/next/no-img-element -- Uploaded photos use local and Blob URLs. */

import { useOptimistic, useState, useTransition } from "react";
import { addComment, toggleIssuePick, toggleReaction } from "./actions";
import type { IssueAnswer, IssueBlock, IssueComment, IssueMood, IssuePick } from "@/lib/issue-view";
import type { IssueTheme, QuestionKind } from "@/lib/issue-experience";
import { Tape } from "@/components/stationery";
import { PhotoWall, type IssuePhoto } from "@/components/photo-wall";
import { MemberAvatar } from "@/components/member-avatar";
import { PostcardDownload } from "@/components/postcard-download";
import { IssueThemePicker } from "./issue-theme-picker";
import { copy, text } from "@/lib/copy";

type Props = {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  canCurate: boolean;
  groupName: string;
  roundNumber: number;
  theme: IssueTheme;
  moods: IssueMood[];
  picks: IssuePick[];
  blocks: IssueBlock[];
  comments: IssueComment[];
};

const KIND_ICONS: Record<QuestionKind, string> = {
  standard: "✎",
  photo: "📸",
  music: "🎧",
  shoutout: "📣",
  recommendation: "👀",
};

export function IssueBody({
  issueId,
  viewerToken,
  canInteract,
  canCurate,
  groupName,
  roundNumber,
  theme,
  moods,
  picks,
  blocks,
  comments,
}: Props) {
  const answers = blocks.flatMap((block) => block.answers.map((answer) => ({ ...answer, question: block.question, kind: block.kind })));
  const photos: IssuePhoto[] = answers
    .filter((answer) => answer.photoUrl)
    .map((answer) => ({
      replyId: answer.replyId,
      author: answer.author,
      question: answer.question,
      body: answer.body,
      url: answer.photoUrl!,
    }));

  return (
    <div className="issue-experience mt-8 flex flex-col gap-7" data-theme-pack={theme}>
      {moods.length > 0 ? (
        <section className="card mood-strip p-4" aria-label={copy.issue.moodTitle}>
          <h2 className="sr-only">{copy.issue.moodTitle}</h2>
          <ul className="flex flex-wrap gap-4">
            {moods.map((mood) => (
              <li key={mood.id} className="flex items-center gap-2 text-[13px] text-ink-soft">
                <MemberAvatar name={mood.author} color={mood.color} className="h-7 w-7 text-[12px]" />
                <span aria-hidden="true" className="text-[22px] leading-none">{mood.emoji}</span>
                <span>{mood.author}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <PhotoWall photos={photos} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <PostcardDownload
          groupName={groupName}
          roundNumber={roundNumber}
          theme={theme}
          moods={moods}
          picks={picks}
          photos={photos}
        />
        {canCurate ? <IssueThemePicker issueId={issueId} theme={theme} viewerToken={viewerToken} /> : null}
      </div>

      {picks.length > 0 ? (
        <section className="card editor-picks p-5 pt-7">
          <Tape tone="stripe" position="right" />
          <h2 className="text-ink">{copy.issue.picksTitle}</h2>
          <p className="mt-1 text-[13px] text-ink-soft">{copy.issue.picksDescription}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {picks.map((pick) => {
              const answer = answers.find((item) => item.replyId === pick.replyId);
              return (
                <blockquote key={pick.replyId} className="editor-pick-quote">
                  <p className="whitespace-pre-wrap">{pick.body || pick.question}</p>
                  <footer className="mt-3 flex items-center gap-2 text-[12px] text-ink-soft">
                    {answer ? <MemberAvatar name={pick.author} color={answer.color} className="h-6 w-6 text-[11px]" /> : null}
                    <strong>{pick.author}</strong>
                    <span className="editor-pick-badge">{pick.editorPick ? copy.issue.editorPick : copy.issue.mostLoved}</span>
                  </footer>
                </blockquote>
              );
            })}
          </div>
        </section>
      ) : null}

      {blocks.filter((block) => block.answers.length > 0).map((block, index) => (
        <section key={block.questionId} className={`card paper ride-in p-5 pt-7 section-kind-${block.kind}`}>
          <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
          <h2 className="issue-question flex items-start gap-3 text-ink">
            <span aria-hidden="true" className="section-kind-icon">{KIND_ICONS[block.kind]}</span>
            <span>{block.question}</span>
          </h2>
          <div className="mt-3">
            {block.answers.map((answer) => (
              <AnswerCard
                key={answer.replyId}
                issueId={issueId}
                viewerToken={viewerToken}
                canInteract={canInteract}
                canCurate={canCurate}
                kind={block.kind}
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
              <div key={comment.id} className="flex gap-3 py-3">
                <MemberAvatar name={comment.author} color={comment.color} className="h-7 w-7 text-[11px]" />
                <div>
                  <p className="text-[13px] font-medium text-ink-soft">{comment.author}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{comment.body}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-ink-muted">{copy.issue.noComments}</p>
        )}
        {canInteract ? <CommentForm issueId={issueId} viewerToken={viewerToken} /> : null}
      </section>
    </div>
  );
}

function AnswerCard({
  issueId,
  viewerToken,
  canInteract,
  canCurate,
  kind,
  answer,
}: {
  issueId: string;
  viewerToken: string | null;
  canInteract: boolean;
  canCurate: boolean;
  kind: QuestionKind;
  answer: IssueAnswer;
}) {
  const [pending, startTransition] = useTransition();
  const [burst, setBurst] = useState(false);
  const [local, addLocal] = useOptimistic(
    answer.reactions,
    (state, emoji: string) =>
      state.map((reaction) =>
        reaction.emoji === emoji
          ? { ...reaction, mine: !reaction.mine, count: reaction.count + (reaction.mine ? -1 : 1) }
          : reaction,
      ),
  );
  const [picked, setPicked] = useOptimistic(answer.editorPick);
  const link = kind === "recommendation" ? recommendationLink(answer.body) : null;

  return (
    <article className={`answer-card answer-kind-${kind} mt-4 border-t border-line pt-4 first:border-t-0`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <MemberAvatar name={answer.author} color={answer.color} />
          <div>
            <p className="m-0 text-[14px] font-extrabold text-ink-soft">{answer.author}</p>
            {answer.mostLoved ? <p className="m-0 text-[11px] font-bold text-accent-ink">{copy.issue.mostLoved}</p> : null}
          </div>
        </div>
        {canCurate ? (
          <button
            type="button"
            className={`pick-button ${picked ? "is-picked" : ""}`}
            aria-pressed={picked}
            aria-label={text(picked ? copy.issue.removePickAriaLabel : copy.issue.addPickAriaLabel, { author: answer.author })}
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                setPicked(!picked);
                await toggleIssuePick({ issueId, replyId: answer.replyId, viewerToken });
              });
            }}
          >
            <span aria-hidden="true">{picked ? "★" : "☆"}</span>
            <span className="sr-only">{picked ? copy.issue.removePick : copy.issue.addPick}</span>
          </button>
        ) : null}
      </div>

      <p className="answer-body mt-2 whitespace-pre-wrap text-[16px] leading-relaxed text-ink">{answer.body}</p>
      {link ? (
        <a href={link.href} target="_blank" rel="noreferrer" className="recommendation-link">
          <span aria-hidden="true">↗</span>
          <span>{link.hostname}</span>
        </a>
      ) : null}
      {answer.photoUrl ? (
        <img
          src={answer.photoUrl}
          alt={answer.body || text(copy.issue.photoAlt, { author: answer.author })}
          className="mt-3 w-full rounded-lg border border-line object-cover"
        />
      ) : null}
      {answer.addedLater ? <p className="mt-2 text-[12px] text-ink-muted">{copy.issue.addedLater}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {local.map((reaction) => (
          <button
            key={reaction.emoji}
            type="button"
            disabled={!canInteract || pending}
            aria-pressed={reaction.mine}
            aria-label={text(copy.issue.reactAriaLabel, { emoji: reaction.emoji })}
            onClick={() => {
              setBurst(true);
              window.setTimeout(() => setBurst(false), 550);
              startTransition(async () => {
                addLocal(reaction.emoji);
                await toggleReaction({ issueId, replyId: answer.replyId, emoji: reaction.emoji, viewerToken });
              });
            }}
            className={`reaction-chip flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-transform disabled:opacity-50 ${
              reaction.mine ? "border-accent-line bg-accent-soft text-accent-ink" : "border-line text-ink-soft hover:bg-field"
            }`}
          >
            <span className={reaction.mine ? "reaction-selected" : ""} aria-hidden>{reaction.emoji}</span>
            {reaction.count > 0 ? <span key={reaction.count} className="reaction-count numeric">{reaction.count}</span> : null}
          </button>
        ))}
        {burst ? <span className="reaction-burst" aria-hidden="true">🍒</span> : null}
      </div>
    </article>
  );
}

function recommendationLink(body: string): { href: string; hostname: string } | null {
  const match = body.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  try {
    const parsed = new URL(match[0].replace(/[.,;:!?)]$/, ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return { href: parsed.toString(), hostname: parsed.hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

function CommentForm({ issueId, viewerToken }: { issueId: string; viewerToken: string | null }) {
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
    <form className="mt-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={2}
        placeholder={copy.issue.commentPlaceholder}
        aria-label={copy.issue.commentAriaLabel}
        className="field"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p role={error ? "alert" : undefined} className="text-[13px] text-danger">{error}</p>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? copy.issue.posting : copy.issue.post}
        </button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IssueComment } from "@/lib/comment-view";
import {
  activeMention,
  insertMention,
  matchMentionables,
  type Mentionable,
} from "@/lib/mention-picker";
import type { MentionPick } from "@/lib/mentions";
import { MAX_PHOTO_BYTES, PHOTO_ACCEPT } from "@/lib/photo-validation";
import { Avatar } from "@/components/avatar";
import { copy, text } from "@/lib/copy";

type Quote = { id: string; author: string };

type ThreadProps = {
  issueId: string;
  viewerToken: string | null;
  /** The answer this thread hangs from; null for the issue-level thread. */
  replyId: string | null;
  comments: IssueComment[];
  mentionables: Mentionable[];
  canInteract: boolean;
  /** The composer's accessible name. */
  composerLabel: string;
  placeholder: string;
  /** Shown when there is nothing yet. */
  empty: string;
};

/** A run of comments and, for members, the box to add another. */
export function CommentThread({
  issueId,
  viewerToken,
  replyId,
  comments,
  mentionables,
  canInteract,
  composerLabel,
  placeholder,
  empty,
}: ThreadProps) {
  const [quote, setQuote] = useState<Quote | null>(null);

  return (
    <div>
      {comments.length > 0 ? (
        <div className="divide-y divide-line border-t border-line">
          {comments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              onReply={canInteract ? () => setQuote({ id: comment.id, author: comment.author }) : null}
            />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[14px] text-ink-muted">{empty}</p>
      )}

      {canInteract ? (
        <CommentComposer
          issueId={issueId}
          viewerToken={viewerToken}
          replyId={replyId}
          mentionables={mentionables}
          label={composerLabel}
          placeholder={placeholder}
          quote={quote}
          onClearQuote={() => setQuote(null)}
        />
      ) : null}
    </div>
  );
}

function CommentItem({ comment, onReply }: { comment: IssueComment; onReply: (() => void) | null }) {
  return (
    <div className="px-1 py-3 sm:px-4">
      <div className="flex items-center gap-2">
        <Avatar name={comment.author} photoUrl={comment.authorPhotoUrl} className="!h-6 !w-6 !text-[11px]" />
        <p className="m-0 text-[13px] font-medium text-ink-soft">{comment.author}</p>
      </div>
      {comment.quote ? (
        <blockquote className="comment-quote mt-1.5">
          {comment.quote.removed ? (
            <p className="m-0 text-[13px] italic text-ink-muted">{comment.quote.text}</p>
          ) : (
            <>
              <p className="m-0 text-[12px] font-bold text-ink-muted">
                {text(copy.issue.quoteBy, { author: comment.quote.author })}
              </p>
              <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-snug text-ink-soft">{comment.quote.text}</p>
            </>
          )}
        </blockquote>
      ) : null}
      {comment.parts.length > 0 ? (
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
          {comment.parts.map((part, index) =>
            part.type === "mention" ? (
              <span key={index} className="mention">@{part.name}</span>
            ) : (
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
      ) : null}
      {comment.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={comment.photoUrl}
          alt={text(copy.issue.commentPhotoAlt, { author: comment.author })}
          className="mt-2 w-full max-w-[420px] rounded-lg border border-line object-cover"
        />
      ) : null}
      {onReply ? (
        <button
          type="button"
          onClick={onReply}
          aria-label={text(copy.issue.commentReplyLabel, { author: comment.author })}
          className="mt-1.5 min-h-8 rounded-md px-1 text-[13px] font-bold text-accent-ink underline decoration-line-strong underline-offset-4"
        >
          {copy.issue.commentReply}
        </button>
      ) : null}
    </div>
  );
}

function CommentComposer({
  issueId,
  viewerToken,
  replyId,
  mentionables,
  label,
  placeholder,
  quote,
  onClearQuote,
}: {
  issueId: string;
  viewerToken: string | null;
  replyId: string | null;
  mentionables: Mentionable[];
  label: string;
  placeholder: string;
  quote: Quote | null;
  onClearQuote: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // One id per comment being written: sending it twice is still one comment.
  const [commentId, setCommentId] = useState(() => crypto.randomUUID());
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const listId = useId();
  // Where the caret goes after a name is dropped in, applied once the new text is on screen.
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current === null || !area.current) return;
    area.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  });

  const trigger = activeMention(value, caret);
  const options = trigger && trigger.start !== dismissedAt ? matchMentionables(mentionables, trigger.query) : [];
  const open = options.length > 0;
  const active = open ? Math.min(highlight, options.length - 1) : 0;

  useEffect(() => {
    if (quote) area.current?.focus();
  }, [quote]);

  const choose = (person: Mentionable) => {
    if (!trigger) return;
    const next = insertMention(value, trigger.start, caret, person.name);
    setValue(next.value);
    setCaret(next.caret);
    setPicks((current) => [...current, { id: person.id, label: person.name }]);
    setHighlight(0);
    pendingCaret.current = next.caret;
    area.current?.focus();
  };

  const submit = () => {
    const body = value.trim();
    if (!body && !photo) {
      setError(copy.issue.writeFirst);
      return;
    }
    const form = new FormData();
    form.set("id", commentId);
    form.set("body", body);
    if (viewerToken) form.set("viewerToken", viewerToken);
    if (replyId) form.set("replyId", replyId);
    if (quote) form.set("quoteCommentId", quote.id);
    if (picks.length > 0) form.set("mentions", JSON.stringify(picks));
    if (photo) form.set("photo", photo, photo.name);

    startTransition(async () => {
      try {
        const response = await fetch(`/api/issue/${issueId}/comments`, { method: "POST", body: form });
        const data = (await response.json()) as { ok?: boolean; error?: string };
        if (!response.ok || !data.ok) {
          setError(data.error ?? copy.issue.postError);
          return;
        }
        setValue("");
        setCaret(0);
        setPicks([]);
        setPhoto(null);
        setError(null);
        setCommentId(crypto.randomUUID());
        onClearQuote();
        router.refresh();
      } catch {
        setError(copy.issue.postError);
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((active + step + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choose(options[active]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDismissedAt(trigger?.start ?? null);
    }
  };

  const onPickPhoto = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_PHOTO_BYTES) {
      setError(copy.issue.errors.photoTooLarge);
    } else if (!PHOTO_ACCEPT.split(",").includes(file.type)) {
      setError(copy.issue.errors.photoInvalid);
    } else {
      setPhoto(file);
      setError(null);
    }
    if (files.current) files.current.value = "";
  };

  return (
    <form
      className="mt-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {quote ? (
        <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-line bg-accent-soft px-3 py-2 text-[13px] text-ink-soft">
          <span>{text(copy.issue.replyingTo, { author: quote.author })}</span>
          <button type="button" onClick={onClearQuote} className="min-h-8 font-bold text-accent-ink underline underline-offset-4">
            {copy.issue.replyingToCancel}
          </button>
        </div>
      ) : null}

      <textarea
        ref={area}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setCaret(event.target.selectionStart);
          setHighlight(0);
          setDismissedAt(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={placeholder}
        aria-label={label}
        aria-autocomplete={mentionables.length > 0 ? "list" : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className="field"
      />

      {open ? (
        <ul id={listId} role="listbox" aria-label={copy.issue.mentionListLabel} className="mention-list">
          {options.map((person, index) => (
            <li
              key={person.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="mention-option"
              onMouseDown={(event) => {
                event.preventDefault();
                choose(person);
              }}
            >
              <Avatar name={person.name} photoUrl={person.photoUrl} className="!h-7 !w-7 !text-[12px]" />
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {open ? text(copy.issue.mentionCount, { count: options.length }) : ""}
      </p>

      {mentionables.length > 0 ? (
        <p className="mt-1.5 text-[12px] text-ink-muted">{copy.issue.mentionHint}</p>
      ) : null}

      {photo ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-soft">
          <span className="min-w-0 truncate">{text(copy.issue.photoChosen, { name: photo.name })}</span>
          <button type="button" onClick={() => setPhoto(null)} className="min-h-8 flex-none font-bold text-accent-ink underline underline-offset-4">
            {copy.issue.removePhoto}
          </button>
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <input
            ref={files}
            type="file"
            accept={PHOTO_ACCEPT}
            hidden
            onChange={(event) => onPickPhoto(event.target.files?.[0])}
          />
          <button type="button" className="btn btn-quiet" onClick={() => files.current?.click()}>
            {copy.issue.addPhoto}
          </button>
        </div>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? copy.issue.posting : copy.issue.post}
        </button>
      </div>
      <p role={error ? "alert" : undefined} className="mt-2 text-[13px] text-danger">
        {error}
      </p>
    </form>
  );
}

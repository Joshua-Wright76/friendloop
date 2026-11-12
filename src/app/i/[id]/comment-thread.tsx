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
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { PHOTO_TARGET, prepareImage } from "@/components/prepare-image";
import { Avatar, NameCharm } from "@/components/avatar";
import { copy, text } from "@/lib/copy";
import { readUploadResponse } from "@/lib/upload-response";
import { deleteComment, restoreComment } from "./actions";

/** Threads up to this long stay open in full. */
const OPEN_COMMENTS = 3;

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
  /** Shown when there is nothing yet; left out where the composer says enough. */
  empty?: string;
  /** Put the cursor in the composer as the thread opens. */
  focusComposer?: boolean;
  /** Keeps the box to write in shut until a comment is answered; "Comment" opens it from outside. */
  composerHidden?: boolean;
  /** Margin notes under an answer: no card chrome, smaller, a thin rule on the left. */
  notes?: boolean;
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
  focusComposer = false,
  composerHidden = false,
  notes = false,
}: ThreadProps) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [all, setAll] = useState(false);
  // Comments taken down during this page view, kept (with their place) so "Undo" has something to bring back.
  const [gone, setGone] = useState<Array<{ comment: IssueComment; index: number }>>([]);
  const router = useRouter();
  const present = new Set(comments.map((comment) => comment.id));
  const goneIds = new Set(gone.map((entry) => entry.comment.id));
  const shownComments = [...comments];
  for (const entry of [...gone].sort((a, b) => a.index - b.index)) {
    if (!present.has(entry.comment.id)) shownComments.splice(Math.min(entry.index, shownComments.length), 0, entry.comment);
  }
  // A short thread is read in full; a long one opens on its latest few.
  const live = shownComments.filter((comment) => !goneIds.has(comment.id)).length;
  const folded = !all && live > OPEN_COMMENTS;
  const visible = folded ? shownComments.slice(-OPEN_COMMENTS) : shownComments;

  return (
    <div className={notes ? "margin-notes" : undefined}>
      {shownComments.length > 0 ? (
        <div className={notes ? "margin-notes__list" : "divide-y divide-line border-t border-line"}>
          {folded ? (
            <div className="comment-fold">
              <button type="button" className="link cursor-pointer" onClick={() => setAll(true)}>
                {text(copy.issue.showAllComments, { count: live })}
              </button>
            </div>
          ) : null}
          {visible.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              notes={notes}
              issueId={issueId}
              viewerToken={viewerToken}
              onReply={canInteract ? () => setQuote({ id: comment.id, author: comment.author }) : null}
              deleted={goneIds.has(comment.id)}
              onDeleted={() => {
                setGone((now) => [...now, { comment, index: shownComments.findIndex((other) => other.id === comment.id) }]);
                router.refresh();
              }}
              onRestored={() => {
                setGone((now) => now.filter((entry) => entry.comment.id !== comment.id));
                router.refresh();
              }}
            />
          ))}
        </div>
      ) : empty ? (
        <p className="mt-2 text-[14px] text-ink-muted">{empty}</p>
      ) : null}

      {canInteract && (!composerHidden || quote) ? (
        <CommentComposer
          issueId={issueId}
          viewerToken={viewerToken}
          replyId={replyId}
          mentionables={mentionables}
          label={composerLabel}
          placeholder={placeholder}
          quote={quote}
          onClearQuote={() => setQuote(null)}
          focusOnMount={focusComposer}
        />
      ) : null}
    </div>
  );
}

function CommentItem({
  comment,
  notes,
  issueId,
  viewerToken,
  onReply,
  deleted,
  onDeleted,
  onRestored,
}: {
  comment: IssueComment;
  notes: boolean;
  issueId: string;
  viewerToken: string | null;
  onReply: (() => void) | null;
  deleted: boolean;
  onDeleted: () => void;
  onRestored: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const undo = useRef<HTMLButtonElement>(null);

  // The Delete button is gone once it is pressed; the keyboard lands on Undo instead.
  useEffect(() => {
    if (deleted) undo.current?.focus();
  }, [deleted]);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, done: () => void) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await task();
        if (!result.ok) setError(result.error ?? copy.issue.errors.invalidRequest);
        else done();
      } catch {
        setError(copy.issue.postError);
      }
    });
  };

  if (deleted) {
    return (
      <div className={notes ? "py-1" : "px-1 py-1 sm:px-4"} role="status">
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-[13px] text-ink-muted">
          <span>{copy.issue.commentDeleted}</span>
          <span aria-hidden="true">·</span>
          <button
            ref={undo}
            type="button"
            aria-disabled={pending ? true : undefined}
            aria-label={copy.issue.commentUndoLabel}
            onClick={() => run(() => restoreComment({ issueId, commentId: comment.id, viewerToken }), onRestored)}
            className="link link--quiet cursor-pointer px-2 text-[13px]"
          >
            {copy.issue.commentUndo}
          </button>
        </p>
        {error ? <p role="alert" className="m-0 text-[13px] text-danger">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className={notes ? "margin-note" : "px-1 py-3 sm:px-4"}>
      <div className="flex items-center gap-2">
        <Avatar name={comment.author} photoUrl={comment.authorPhotoUrl} frame={comment.authorFrame} className="avatar-flush [--aw:24px] !h-6 !w-6 !text-[11px]" />
        <p className="m-0 text-[13px] font-medium text-ink-soft">{comment.author}</p>
        <NameCharm charm={comment.authorCharm} />
      </div>
      {comment.quote ? (
        <blockquote className="comment-quote mt-1.5">
          {comment.quote.removed ? (
            <p className="m-0 text-[13px] italic text-ink-muted">{comment.quote.text}</p>
          ) : (
            <>
              <p className="m-0 text-[13px] font-bold text-ink-muted">
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
          loading="lazy"
          decoding="async"
          className="mt-2 w-full max-w-[420px] rounded-lg border border-line object-cover"
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4">
        {onReply ? (
          <button
            type="button"
            onClick={onReply}
            aria-label={text(copy.issue.commentReplyLabel, { author: comment.author })}
            className="link min-w-11 cursor-pointer justify-center px-2"
          >
            {copy.issue.commentReply}
          </button>
        ) : null}
        {comment.isYou && onReply ? (
          <button
            type="button"
            aria-disabled={pending ? true : undefined}
            aria-label={copy.issue.commentDeleteLabel}
            onClick={() => run(() => deleteComment({ issueId, commentId: comment.id, viewerToken }), onDeleted)}
            className="link link--quiet min-w-11 cursor-pointer justify-center px-2"
          >
            {copy.issue.commentDelete}
          </button>
        ) : null}
        {error ? <span role="alert" className="text-[13px] text-danger">{error}</span> : null}
      </div>
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
  focusOnMount,
}: {
  issueId: string;
  viewerToken: string | null;
  replyId: string | null;
  mentionables: Mentionable[];
  label: string;
  placeholder: string;
  quote: Quote | null;
  onClearQuote: () => void;
  focusOnMount: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [photo, setPhoto] = useState<File | null>(null);
  // While a picked photo is being shrunk, Post and the picker wait: otherwise the
  // comment could go without it, and the photo would turn up on the next one.
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which control the error is about; errors that name no field stay unattached.
  const [errorField, setErrorField] = useState<"body" | "photo" | null>(null);
  const [posted, setPosted] = useState("");
  const [pending, startTransition] = useTransition();
  // One id per comment being written: sending it twice is still one comment.
  const [commentId, setCommentId] = useState(() => crypto.randomUUID());
  const [highlight, setHighlight] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  // Put the caret in the box without yanking the page: a bare focus() centres the box, which can
  // park the answer's reaction row under the sticky bar. "Nearest" only moves the page when the
  // box is out of sight, and then by the least it can (honouring the page's scroll padding), and
  // the focus itself scrolls nothing.
  const focusArea = () => {
    const box = area.current;
    if (!box) return;
    box.scrollIntoView({ block: "nearest" });
    box.focus({ preventScroll: true });
  };
  const listId = useId();
  const errorId = `${listId}-error`;
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
    if (quote) focusArea();
  }, [quote]);

  // A thread opened on purpose is opened to write in.
  useEffect(() => {
    if (focusOnMount) focusArea();
  }, [focusOnMount]);

  const choose = (person: Mentionable) => {
    if (!trigger) return;
    const next = insertMention(value, trigger.start, caret, person.name);
    setValue(next.value);
    setCaret(next.caret);
    setPicks((current) => [...current, { id: person.id, label: person.name }]);
    setHighlight(0);
    pendingCaret.current = next.caret;
    focusArea();
  };

  const submit = () => {
    if (preparing) return;
    const body = value.trim();
    if (pending) return;
    if (!body && !photo) {
      setError(copy.issue.writeFirst);
      setErrorField("body");
      focusArea();
      return;
    }
    setPosted("");
    setErrorField(null);
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
        const data = await readUploadResponse<{ ok?: boolean; error?: string }>(response, copy.issue.errors.photoTooLarge);
        if (!response.ok || !data.ok) {
          setError(data.error ?? copy.issue.postError);
          return;
        }
        setPosted(copy.a11yStatus.commentPosted);
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

  const onPickPhoto = async (picked: File | undefined) => {
    if (files.current) files.current.value = "";
    if (!picked) return;
    // Camera-roll photos are shrunk here rather than refused for their size.
    setPreparing(true);
    const prepared = await prepareImage(picked, PHOTO_TARGET);
    setPreparing(false);
    if (!prepared.ok) {
      setError(copy.issue.errors.photoUnreadable);
      setErrorField("photo");
      return;
    }
    setPhoto(prepared.file);
    setPosted(text(copy.a11yStatus.photoAttached, { name: prepared.file.name }));
    setError(null);
    setErrorField(null);
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
          <button type="button" onClick={() => { onClearQuote(); focusArea(); }} className="link cursor-pointer">
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
          setPosted("");
          if (errorField === "body") {
            setError(null);
            setErrorField(null);
          }
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={errorField === "body" ? "true" : undefined}
        aria-describedby={errorField === "body" ? errorId : undefined}
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
              // Keep the textarea focused on press, but only act on release so a press can be aborted (2.5.2).
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(person)}
            >
              <Avatar name={person.name} photoUrl={person.photoUrl} className="!h-7 !w-7 !text-[13px]" />
              {person.name}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {open ? text(copy.issue.mentionCount, { count: options.length }) : posted}
      </p>

      {mentionables.length > 0 ? (
        <p className="mt-1.5 text-[13px] text-ink-muted">{copy.issue.mentionHint}</p>
      ) : null}

      {photo ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-soft">
          <span className="min-w-0 wrap-any">{text(copy.issue.photoChosen, { name: photo.name })}</span>
          <button type="button" onClick={() => { setPhoto(null); setPosted(copy.a11yStatus.photoRemoved); focusArea(); }} className="link flex-none cursor-pointer">
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
            onChange={(event) => void onPickPhoto(event.target.files?.[0])}
          />
          <button
            type="button"
            className="btn btn-quiet aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            aria-disabled={preparing || pending ? true : undefined}
            aria-describedby={errorField === "photo" ? errorId : undefined}
            onClick={() => { if (!preparing && !pending) files.current?.click(); }}
          >
            {preparing ? copy.issue.preparingPhoto : copy.issue.addPhoto}
          </button>
        </div>
        {/* aria-disabled, not disabled: the button the keyboard is on must keep focus while posting. */}
        <button
          type="submit"
          aria-disabled={pending || preparing ? true : undefined}
          className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
        >
          {pending ? copy.issue.posting : copy.issue.post}
        </button>
      </div>
      <p id={errorId} role="alert" className="mt-2 text-[13px] text-danger">
        {error}
      </p>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";

const MAX_LENGTH = 2000;

type Status = "idle" | "sending" | "sent";

/**
 * The corner button: one box, one Send. Everything else a report needs — the
 * page, the screen size, who they are when we know — travels with it, so the
 * person writing never fills in anything but their own words.
 */
export function FeedbackButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  // Permanent, so the thank-you is announced as a change rather than lost as a new node.
  const [announcement, setAnnouncement] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // The form only exists while the dialog is up, so pages that promise "no
  // text box here" stay true and nothing sits in the DOM unused.
  const [isOpen, setIsOpen] = useState(false);

  const open = () => {
    setError(null);
    setIsOpen(true);
    dialog.current?.showModal();
  };

  const close = () => {
    dialog.current?.close();
    // A sent note leaves an empty box next time; an unsent one is kept.
    if (status === "sent") {
      setMessage("");
      setStatus("idle");
      setAnnouncement("");
    }
  };

  // Focus waits for the sent view, then lands on Done once the announcement is already in place.
  useEffect(() => {
    if (status === "sent") done.current?.focus();
  }, [status]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (status === "sending") return;
    setStatus("sending");
    setError(null);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          path: window.location.pathname,
          viewport: `${window.innerWidth}×${window.innerHeight}`,
        }),
      });
      if (response.ok) {
        setAnnouncement(copy.a11yStatus.feedbackSent);
        setStatus("sent");
        return;
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? copy.feedback.errors.network);
    } catch {
      setError(copy.feedback.errors.network);
    }
    setStatus("idle");
  };

  return (
    <>
      <button type="button" className="feedback-button" onClick={open} aria-haspopup="dialog">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="feedback-button-icon">
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6a.5.5 0 0 1-.8-.4V16h-.5A2.5 2.5 0 0 1 4 13.5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
        <span className="feedback-button-label">{copy.feedback.open}</span>
      </button>

      <dialog
        ref={dialog}
        className="wizard-dialog feedback-dialog"
        aria-labelledby="feedback-title"
        onClose={() => {
          setIsOpen(false);
          if (status === "sent") {
            setMessage("");
            setStatus("idle");
            setAnnouncement("");
          }
        }}
      >
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {!isOpen ? null : status === "sent" ? (
          <div>
            <h2 id="feedback-title" className="text-ink">{copy.feedback.thanks}</h2>
            <button ref={done} type="button" className="btn btn-primary mt-5" onClick={close}>
              {copy.feedback.done}
            </button>
          </div>
        ) : (
          <form onSubmit={send}>
            <h2 id="feedback-title" className="text-ink">{copy.feedback.title}</h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{copy.feedback.hint}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">{copy.feedback.audience}</p>
            <label htmlFor="feedback-message" className="sr-only">{copy.feedback.label}</label>
            <textarea
              id="feedback-message"
              className="field mt-4"
              rows={5}
              maxLength={MAX_LENGTH}
              value={message}
              placeholder={copy.feedback.placeholder}
              onChange={(event) => setMessage(event.target.value)}
              autoFocus
            />
            <p className="mt-1.5 text-[13px] text-ink-muted numeric">
              {text(copy.feedback.count, { remaining: MAX_LENGTH - message.length })}
            </p>
            <p role="alert" className="mt-2 min-h-5 text-[13px] text-danger">{error}</p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <button type="button" className="btn btn-quiet" onClick={close}>
                {copy.feedback.cancel}
              </button>
              <button type="submit" className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-45" aria-disabled={status === "sending" || !message.trim() ? true : undefined}>
                {status === "sending" ? copy.feedback.sending : copy.feedback.send}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </>
  );
}

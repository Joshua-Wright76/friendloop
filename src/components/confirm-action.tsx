"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { copy } from "@/lib/copy";
import { isFrameworkSignal } from "./safe-form";

type Tone = "danger" | "primary" | "quiet";

function Confirm({ label, tone }: { label: string; tone: Tone }) {
  const { pending } = useFormStatus();
  return (
    // aria-disabled, not disabled: the button the keyboard is on must not vanish mid-request.
    <button
      type="submit"
      aria-disabled={pending ? true : undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"} min-h-11 px-4 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45`}
    >
      {pending ? copy.common.loading : label}
    </button>
  );
}

/**
 * An action with consequences, in two steps: the first button only opens a question
 * that names what will happen, and the question takes the full width of whatever it
 * sits in. Focus moves to the question, and back to the first button if the person
 * changes their mind.
 */
export function ConfirmAction({
  action,
  fields,
  label,
  triggerLabel,
  question,
  body,
  confirmLabel,
  cancelLabel,
  className = "",
  tone = "danger",
  triggerTone,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: string;
  triggerLabel: string;
  question: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Applied to the first button's wrapper. The open question always stands on its own row. */
  className?: string;
  /** How serious this is: "danger" is for things that cannot simply be undone. */
  tone?: Tone;
  triggerTone?: Tone | "link";
}) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const cancelled = useRef(false);
  const titleId = useId();
  const bodyId = useId();
  const shown = triggerTone ?? tone;
  const quietConfirm: Tone = tone === "danger" ? "danger" : "primary";

  useEffect(() => {
    if (asking) title.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  // The panel closes when the action finishes, so a page that stays mounted (settings)
  // is not left asking. If it fails, the question stays open and says so.
  async function run(formData: FormData) {
    setFailed(false);
    try {
      await action(formData);
      setAsking(false);
    } catch (error) {
      if (isFrameworkSignal(error)) throw error;
      setFailed(true);
    }
  }

  function cancel() {
    cancelled.current = true;
    setAsking(false);
  }

  if (!asking) {
    return (
      <div className={className}>
        <button
          ref={trigger}
          type="button"
          aria-label={triggerLabel}
          onClick={() => setAsking(true)}
          className={shown === "link" ? "link px-2" : `btn ${shown === "danger" ? "btn-danger-quiet" : shown === "primary" ? "btn-primary" : "btn-quiet"} min-h-11 px-4 text-[14px]`}
        >
          {label}
        </button>
      </div>
    );
  }

  return (
    <form
      action={run}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onKeyDown={(event) => {
        if (event.key === "Escape") cancel();
      }}
      className={`confirm-panel${tone === "danger" ? " confirm-panel--danger" : ""}`}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p id={titleId} ref={title} tabIndex={-1} className="text-[16px] font-extrabold leading-snug text-ink">{question}</p>
      <p id={bodyId} className="mt-1 text-[14px] leading-relaxed text-ink-soft">{body}</p>
      {failed ? <p role="alert" className="action-failed">{copy.common.actionFailed}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Confirm label={confirmLabel} tone={quietConfirm} />
        <button type="button" onClick={cancel} className="btn btn-quiet min-h-11 px-4 text-[14px]">
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

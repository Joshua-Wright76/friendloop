"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { copy } from "@/lib/copy";

function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    // aria-disabled, not disabled: the button the keyboard is on must not vanish mid-request.
    <button
      type="submit"
      aria-disabled={pending ? true : undefined}
      onClick={(event) => {
        if (pending) event.preventDefault();
      }}
      className="btn btn-primary min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
    >
      {pending ? copy.common.loading : label}
    </button>
  );
}

/**
 * A destructive action in two steps: the first button only opens a question that
 * names what will happen. Focus moves to the question, and back to the first
 * button if the person changes their mind.
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
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields: Record<string, string>;
  label: string;
  triggerLabel: string;
  question: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const title = useRef<HTMLParagraphElement>(null);
  const cancelled = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (asking) title.current?.focus();
    else if (cancelled.current) {
      cancelled.current = false;
      trigger.current?.focus();
    }
  }, [asking]);

  // The panel closes when the action finishes, so a page that stays mounted (settings) is not left asking.
  async function run(formData: FormData) {
    try {
      await action(formData);
    } finally {
      setAsking(false);
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
          className="btn btn-quiet min-h-11 px-4 text-[13px]"
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
      className={`notice border bg-accent-soft px-4 py-3 ${className}`}
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <p id={titleId} ref={title} tabIndex={-1} className="text-[15px] font-bold text-ink outline-none">{question}</p>
      <p id={bodyId} className="mt-1 text-[14px] leading-relaxed text-ink-soft">{body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Confirm label={confirmLabel} />
        <button type="button" onClick={cancel} className="btn btn-quiet min-h-11 px-4 text-[13px]">
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

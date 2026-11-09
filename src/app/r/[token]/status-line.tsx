"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { copy, text } from "@/lib/copy";
import { STATUS_LINE_MAX } from "@/lib/looks";
import { postReply } from "@/lib/reply-client";

export type LineStatus = "idle" | "saving" | "saved" | "error";

/** Characters as people count them: an emoji is one. */
const lengthOf = (value: string) => [...value].length;
const clip = (value: string) => [...value].slice(0, STATUS_LINE_MAX).join("");

/**
 * "Your line this round": one optional line above the first question, saved as it's
 * typed like an answer, with a few starters for when nothing comes to mind. Empty
 * takes it away.
 */
export function StatusLineField({
  token,
  initial,
  disabled,
  onStatus,
  track,
}: {
  token: string;
  initial: string;
  disabled: boolean;
  /** The sheet's save line at the bottom reads this too. */
  onStatus: (status: LineStatus) => void;
  /** Lets Done wait for a save still on its way. */
  track: (save: Promise<unknown>) => void;
}) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<LineStatus>(initial ? "saved" : "idle");
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saved = useRef(initial);
  const latest = useRef(initial);
  const revision = useRef(0);
  const id = useId();

  const report = useCallback((next: LineStatus) => {
    setStatus(next);
    onStatus(next);
  }, [onStatus]);

  const persist = useCallback((body: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (body.trim() === saved.current.trim()) {
      report(body.trim() ? "saved" : "idle");
      return;
    }
    const mine = ++revision.current;
    report("saving");
    const save = postReply(token, { action: "line", body }, copy.reply.statusLine.error).then((result) => {
      if (revision.current !== mine) return;
      if (result.ok) {
        saved.current = body;
        report(body.trim() ? "saved" : "idle");
      } else {
        report("error");
      }
    });
    track(save);
  }, [report, token, track]);

  const change = (next: string) => {
    const clipped = clip(next);
    latest.current = clipped;
    setValue(clipped);
    report("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => persist(clipped), 600);
  };

  // On the way out, a line still waiting goes with a beacon, like the answers do.
  useEffect(() => {
    const flush = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const payload = JSON.stringify({ action: "line", body: latest.current });
      if (!navigator.sendBeacon?.(`/api/reply/${token}`, new Blob([payload], { type: "application/json" }))) {
        void fetch(`/api/reply/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => undefined);
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [token]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const count = lengthOf(value);
  return (
    <section className="card status-line-card p-4 pt-3" aria-labelledby={`${id}-label`}>
      <span className="question-status" aria-live="polite">
        {status === "saving" ? <span>{copy.reply.questionStates.saving}</span> : null}
        {status === "saved" && value.trim() ? (
          <span className="question-status__saved">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 flex-none"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {copy.reply.questionStates.saved}
          </span>
        ) : null}
      </span>
      <label id={`${id}-label`} htmlFor={`${id}-field`} className="block pr-20 text-[14px] font-extrabold text-ink">
        {copy.reply.statusLine.label} <span className="font-bold text-ink-muted">· {copy.reply.statusLine.optional}</span>
      </label>
      <input
        ref={field}
        id={`${id}-field`}
        value={value}
        onChange={(event) => change(event.target.value)}
        onBlur={() => persist(latest.current)}
        disabled={disabled}
        enterKeyHint="done"
        autoComplete="off"
        placeholder={copy.reply.statusLine.placeholder}
        aria-describedby={`${id}-count`}
        aria-invalid={status === "error" ? true : undefined}
        className="field mt-1.5 h-11 py-0"
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            persist(latest.current);
          }
        }}
      />
      <p className="m-0 mt-1 flex justify-between gap-3 text-[12.5px] text-ink-muted">
        <span id={`${id}-count`} className="sr-only">{text(copy.reply.statusLine.countLabel, { max: STATUS_LINE_MAX })}</span>
        {status === "error" ? <span role="alert" className="font-bold text-danger">{copy.reply.statusLine.error}</span> : <span />}
        <span aria-hidden="true" className="numeric">{text(copy.reply.statusLine.count, { count, max: STATUS_LINE_MAX })}</span>
      </p>
      <div role="group" aria-label={copy.reply.statusLine.startersLabel} className="status-starters">
        {copy.reply.statusLine.starters.map((starter) => (
          <button
            key={starter}
            type="button"
            className="status-starter"
            disabled={disabled}
            onClick={() => {
              // The starter fills the field and leaves the cursor at its end, ready for the rest.
              const filled = `${starter.replace(/…$/, "").trimEnd()} `;
              change(filled);
              requestAnimationFrame(() => {
                const input = field.current;
                if (!input) return;
                input.focus();
                input.setSelectionRange(input.value.length, input.value.length);
              });
            }}
          >
            {starter}
          </button>
        ))}
      </div>
    </section>
  );
}

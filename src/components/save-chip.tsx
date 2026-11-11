import type { ReactNode } from "react";

export type SaveState = "idle" | "saving" | "saved" | "adjusted" | "error";

/**
 * How an autosaving form says it went: a quiet line while idle, then "Saving…", a
 * "✓ Saved" chip that fades after a moment, or the error with a way to retry. The element
 * stays mounted (a live region that appears with its text is often not announced).
 */
export function SaveChip({ state, idle, saving, saved, adjusted, error, retryLabel, onRetry, className = "" }: {
  state: SaveState;
  idle: string;
  saving: string;
  saved: string;
  adjusted?: string;
  error: string;
  retryLabel: string;
  onRetry: () => void;
  className?: string;
}): ReactNode {
  const done = state === "saved" || state === "adjusted";
  return (
    <p role="status" aria-live="polite" className={`look-status${state === "error" ? " look-status--danger" : ""}${done ? " look-status--saved" : ""}${state === "idle" ? " look-status--idle" : ""} ${className}`.trim()}>
      {state === "idle" ? idle : null}
      {state === "saving" ? saving : null}
      {done ? (
        <>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5 flex-none"><path d="m4.5 10.5 3.8 3.8L15.5 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          {state === "adjusted" ? adjusted ?? saved : saved}
        </>
      ) : null}
      {state === "error" ? (
        <>
          {error}{" "}
          <button type="button" className="look-status__retry" onClick={onRetry}>{retryLabel}</button>
        </>
      ) : null}
    </p>
  );
}

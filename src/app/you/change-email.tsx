"use client";

import { useActionState, useId } from "react";
import { copy, text } from "@/lib/copy";
import { requestEmailChangeAction, type EmailChangeState } from "./actions";

/** Change your address. Nothing moves until the link sent to the new one is used. */
export function ChangeEmail() {
  const inputId = useId();
  const messageId = useId();
  const [state, action, pending] = useActionState<EmailChangeState, FormData>(requestEmailChangeAction, null);
  const failed = state && state.outcome !== "sent";
  const message = !state
    ? null
    : state.outcome === "sent"
      ? text(copy.you.emailChangeSent, { email: state.email })
      : state.outcome === "same"
        ? copy.you.emailChangeSame
        : state.outcome === "busy"
          ? copy.you.emailChangeBusy
          : copy.you.emailChangeInvalid;

  return (
    <form action={action} className="mt-3 flex flex-col gap-1.5" noValidate>
      <label htmlFor={inputId} className="text-[14px] font-bold text-ink-soft">{copy.you.emailChangeLabel}</label>
      <input
        id={inputId}
        name="email"
        type="email"
        autoComplete="email"
        required
        aria-invalid={failed ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className="field min-h-11"
      />
      {message ? (
        failed ? (
          <p id={messageId} role="alert" className="wrap-any text-[14px] font-bold text-danger">{message}</p>
        ) : (
          // Sent is the moment to look away to the inbox, so it reads as a confirmation, not a footnote.
          <p id={messageId} role="status" className="notice settle mt-1 flex items-start gap-2 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-1 h-4 w-4 flex-none"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="wrap-any">{message}</span>
          </p>
        )
      ) : null}
      <div>
        <button type="submit" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]" aria-disabled={pending ? true : undefined}>
          {copy.you.emailChangeSubmit}
        </button>
      </div>
    </form>
  );
}

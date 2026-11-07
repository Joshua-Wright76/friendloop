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
        <p id={messageId} role={failed ? "alert" : "status"} className={`wrap-any text-[13px] ${failed ? "text-danger" : "text-ink-soft"}`}>
          {message}
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]" aria-disabled={pending ? true : undefined}>
          {copy.you.emailChangeSubmit}
        </button>
      </div>
    </form>
  );
}

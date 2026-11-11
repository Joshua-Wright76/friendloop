"use client";

import { useActionState } from "react";
import { resendLink, type ResendState } from "../actions";
import { copy, text } from "@/lib/copy";

const initial: ResendState = {};

/** A quiet one-tap "Send it again" that keeps the address this browser already gave. */
export function ResendLink() {
  const [state, action, pending] = useActionState(async () => resendLink(), initial);

  return (
    <form action={action} className="mt-2">
      {/* aria-disabled, not disabled: pressing it must not drop keyboard focus. */}
      <button
        type="submit"
        aria-disabled={pending ? true : undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        className="inline-flex min-h-11 items-center text-[14px] font-bold text-accent-ink underline decoration-accent/30 underline-offset-4"
      >
        {pending ? copy.checkEmail.sendingAgain : copy.checkEmail.sendAgain}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-[13px] leading-relaxed text-ink-soft [overflow-wrap:anywhere]">
        {state.sentTo ? text(copy.checkEmail.sentAgain, { email: state.sentTo }) : state.error ?? null}
      </p>
    </form>
  );
}

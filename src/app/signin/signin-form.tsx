"use client";

import { useActionState } from "react";
import { requestLink, type SignInState } from "./actions";
import { copy } from "@/lib/copy";

const initial: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(requestLink, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">{copy.signIn.emailLabel}</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder={copy.signIn.emailPlaceholder}
          className="field h-[46px] py-0"
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-[14px] leading-snug text-danger">
          {state.error}
        </p>
      ) : null}

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? copy.signIn.sending : copy.signIn.submit}
      </button>

    </form>
  );
}

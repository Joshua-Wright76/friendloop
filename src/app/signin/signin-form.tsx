"use client";

import { useActionState, useState } from "react";
import { requestLink, type SignInState } from "./actions";
import { copy } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";

const initial: SignInState = {};

export function SignInForm() {
  const [state, action, pending] = useActionState(requestLink, initial);
  // Controlled, so a failed submit does not wipe what was typed (React resets uncontrolled fields).
  const [email, setEmail] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <FieldLabel required>{copy.signIn.emailLabel}</FieldLabel>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={state.error ? "true" : undefined}
          aria-describedby={state.error ? "signin-error" : undefined}
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder={copy.signIn.emailPlaceholder}
          className="field h-[46px] py-0"
        />
      </label>

      {state.error ? (
        <p id="signin-error" role="alert" className="text-[14px] leading-snug text-danger">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        aria-disabled={pending ? true : undefined}
        onClick={(event) => {
          if (pending) event.preventDefault();
        }}
        className="btn btn-primary w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
      >
        {pending ? copy.signIn.sending : copy.signIn.submit}
      </button>

    </form>
  );
}

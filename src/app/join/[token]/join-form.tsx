"use client";

import { useActionState, useState } from "react";
import { requestJoin, type JoinState } from "./actions";
import { copy } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";

const initial: JoinState = {};

/** The address to confirm. The same checks as signing in, so the two forms read alike. */
export function JoinForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(requestJoin, initial);
  // Controlled, so a failed submit does not wipe what was typed.
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const error = localError ?? state.error;

  return (
    <form
      action={action}
      noValidate
      onSubmit={(event) => {
        const field = event.currentTarget.elements.namedItem("email") as HTMLInputElement;
        const value = field.value.trim();
        const problem = value === "" ? copy.signIn.emptyEmail : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : copy.signIn.invalidEmail;
        setLocalError(problem);
        if (problem || pending) {
          event.preventDefault();
          if (problem) field.focus();
        }
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5">
        <FieldLabel required>{copy.join.emailLabel}</FieldLabel>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setLocalError(null); }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "join-hint join-error" : "join-hint"}
          required
          autoComplete="email"
          inputMode="email"
          placeholder={copy.signIn.emailPlaceholder}
          className="field h-[46px] py-0"
        />
        <span id="join-hint" className="text-[13px] leading-relaxed text-ink-muted">{copy.join.emailHint}</span>
      </label>

      {error ? (
        <p id="join-error" role="alert" className="text-[14px] font-bold leading-snug text-danger">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        aria-disabled={pending ? true : undefined}
        className="btn btn-primary w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
      >
        {pending ? copy.join.sending : copy.join.submit}
      </button>
    </form>
  );
}

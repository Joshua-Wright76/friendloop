"use client";

import { useActionState, useState } from "react";
import { requestLink, type SignInState } from "./actions";
import { copy } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";

const initial: SignInState = {};

export function SignInForm({ start = false }: { start?: boolean }) {
  const [state, action, pending] = useActionState(requestLink, initial);
  // Controlled, so a failed submit does not wipe what was typed (React resets uncontrolled fields).
  const [email, setEmail] = useState("");
  // Our own message instead of the browser's bubble, so it reads like the rest of the page.
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
        if (problem) {
          event.preventDefault();
          field.focus();
        }
      }}
      className="flex flex-col gap-4"
    >
      {start ? <input type="hidden" name="start" value="1" /> : null}
      <label className="flex flex-col gap-1.5">
        <FieldLabel required>{copy.signIn.emailLabel}</FieldLabel>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(event) => { setEmail(event.target.value); setLocalError(null); }}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "signin-error" : undefined}
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          placeholder={copy.signIn.emailPlaceholder}
          className="field h-[46px] py-0"
        />
      </label>

      {error ? (
        <p id="signin-error" role="alert" className="text-[14px] font-bold leading-snug text-danger">
          {error}
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

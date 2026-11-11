"use client";

import { useActionState, useState, useSyncExternalStore } from "react";
import { enterCode, type CodeState } from "../actions";
import { copy } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";

const initial: CodeState = {};

function subscribeToNothing() {
  return () => {};
}

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * For signing in where the email isn't: another device, or the app on a home
 * screen. `askEmail` is set when this browser didn't just ask for the code.
 */
export function CodeForm({ askEmail, joining = false }: { askEmail: boolean; joining?: boolean }) {
  const [state, action, pending] = useActionState(enterCode, initial);
  const timezone = useSyncExternalStore(subscribeToNothing, browserTimezone, () => "");
  // Controlled, so a wrong code doesn't wipe the address.
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  return (
    <form action={action} className="flex flex-col gap-4 text-left">
      <input type="hidden" name="timezone" value={timezone} />
      {askEmail ? (
        <label className="flex flex-col gap-1.5">
          <FieldLabel required>{copy.checkEmail.codeEmailLabel}</FieldLabel>
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            aria-invalid={state.error ? "true" : undefined}
            aria-describedby={state.error ? "code-error" : undefined}
            autoComplete="email"
            inputMode="email"
            placeholder={copy.signIn.emailPlaceholder}
            className="field h-[46px] py-0"
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <FieldLabel required>{copy.checkEmail.codeLabel}</FieldLabel>
        <input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
          // Lets iOS and Android offer the code straight from the email.
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={9}
          aria-invalid={state.error ? "true" : undefined}
          aria-describedby={state.error ? "code-error" : undefined}
          placeholder="123456"
          className="field h-[52px] py-0 text-center font-mono text-[24px] tracking-[0.3em]"
        />
      </label>

      {state.error ? (
        <p id="code-error" role="alert" className="text-[14px] font-bold leading-snug text-danger">
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
        {joining ? copy.checkEmail.codeSubmitJoin : copy.checkEmail.codeSubmit}
      </button>
    </form>
  );
}

"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { inviteAction } from "./actions";

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteForm({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const inputId = useId();
  const field = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const errorId = useId();
  const [pending, startTransition] = useTransition();

  function add(raw: string) {
    const parsed = raw.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    const good = parsed.filter((email) => validEmail.test(email));
    const bad = parsed.filter((email) => !validEmail.test(email));
    // Good addresses become chips whatever else was pasted. A bad one stays in the field, named.
    setEmails((current) => [...new Set([...current, ...good])]);
    setInput(bad.join(" "));
    if (bad.length) {
      setStatus("");
      setError(text(copy.members.invalidEmailNamed, { emails: bad.join(", ") }));
    } else if (parsed.length) {
      setError("");
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (pending) return;
    if (["Enter", ",", ";", " "].includes(event.key) && input.trim()) {
      event.preventDefault();
      add(input);
    } else if (event.key === "Backspace" && !input && emails.length) {
      setEmails(emails.slice(0, -1));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (input.trim()) add(input);
    const pendingEmails = input.trim()
      ? [...new Set([...emails, ...input.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter((email) => validEmail.test(email))])]
      : emails;
    if (input.trim().split(/[\s,;]+/).some((email) => email && !validEmail.test(email))) return;
    if (!pendingEmails.length) {
      setStatus("");
      setError(copy.members.invalidEmails);
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("groupId", groupId);
      pendingEmails.forEach((email) => data.append("emails", email));
      let result: Awaited<ReturnType<typeof inviteAction>>;
      try {
        result = await inviteAction(data);
      } catch {
        // Offline or a dropped request: keep the addresses so they can just try again.
        setStatus("");
        setError(copy.members.inviteFailed);
        return;
      }
      if (!result.ok) {
        setStatus("");
        setError(result.message === "invalid" ? copy.members.invalidEmails : copy.members.inviteFailed);
      } else {
        setEmails([]);
        setError("");
        setStatus(
          result.invited > 0 && result.skipped > 0
            ? text(copy.members.invitePartial, { invited: result.invited, skipped: result.skipped })
            : result.skipped > 0
              ? text(copy.members.inviteSkipped, { count: result.skipped })
              : copy.members.inviteSuccess,
        );
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} id="invite-people" className="mt-3 scroll-mt-4 border-t border-dashed border-line pt-3">
      <input type="hidden" name="groupId" value={groupId} />
      <label htmlFor={inputId} className="block text-[14px] font-bold text-ink-soft">{copy.members.inviteAriaLabel}</label>
      <p id={hintId} className="sr-only">{copy.members.inviteDescription}</p>
      <div className="invite-line mt-1.5">
      <div className="field flex min-h-11 flex-wrap items-center gap-2 py-1" onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
        {emails.map((email) => (
          <span key={email} className="chip inline-flex max-w-full items-center gap-1 border bg-card py-0.5 pl-3 pr-1 text-[13px] font-bold text-ink">
            <span className="wrap-any">{email}</span>
            <button
              type="button"
              aria-label={text(copy.members.removeEmail, { email })}
              aria-disabled={pending ? true : undefined}
              onClick={() => {
                if (pending) return;
                // The chip leaves with its button, so the field is where the keyboard carries on.
                setEmails(emails.filter((item) => item !== email));
                field.current?.focus();
              }}
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-ink-muted hover:bg-field hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            ><svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5"><path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg></button>
          </span>
        ))}
        <input
          ref={field}
          id={inputId}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (input.trim()) add(input); }}
          placeholder={copy.members.invitePlaceholder}
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          readOnly={pending}
          aria-disabled={pending ? true : undefined}
          className="min-w-[8rem] flex-1 border-0 bg-transparent p-1 text-[15px] text-ink outline-none"
        />
      </div>
      {error ? <p id={errorId} role="alert" className="m-0 order-1 basis-full text-[13px] font-bold text-danger">{error}</p> : null}
      <button
        type="submit"
        // Leaving the field turns its address into a chip, which moves this button out
        // from under a finger mid-tap. Keeping focus put means the first tap sends.
        onMouseDown={(event) => event.preventDefault()}
        aria-disabled={pending ? true : undefined}
        className="btn btn-primary flex-none aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{pending ? copy.common.loading : copy.members.sendInvitations}</button>
      </div>
      <p role="status" className="mt-2 text-[13px] text-ink-soft empty:mt-0">{status}</p>
    </form>
  );
}

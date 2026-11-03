"use client";

import { useId, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { FieldLabel } from "@/components/field-label";
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
    if (parsed.some((email) => !validEmail.test(email))) {
      setStatus("");
      setError(copy.members.invalidEmails);
      return;
    }
    if (parsed.length) setError("");
    setEmails((current) => [...new Set([...current, ...parsed])]);
    setInput("");
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
    if (!pendingEmails.length || input.trim().split(/[\s,;]+/).some((email) => email && !validEmail.test(email))) {
      setStatus("");
      setError(copy.members.invalidEmails);
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("groupId", groupId);
      pendingEmails.forEach((email) => data.append("emails", email));
      const result = await inviteAction(data);
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
    <form onSubmit={submit} id="invite-people" className="card mt-5 p-5">
      <input type="hidden" name="groupId" value={groupId} />
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.members.inviteTitle}</h2>
      <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-ink-soft">{copy.members.inviteDescription}</p>
      <label htmlFor={inputId} className="mt-3 block"><FieldLabel required>{copy.members.inviteAriaLabel}</FieldLabel></label>
      <div className="field mt-1.5 flex min-h-12 flex-wrap items-center gap-2" onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
        {emails.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-[13px] text-ink">
            {email}
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
              className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-ink-muted hover:bg-field hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            >×</button>
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
          className="min-w-[180px] flex-1 border-0 bg-transparent p-1 text-[14px] text-ink outline-none"
        />
      </div>
      {error ? <p id={errorId} role="alert" className="mt-2 text-[13px] text-danger">{error}</p> : null}
      <p role="status" className="mt-2 text-[13px] text-ink-soft empty:mt-0">{status}</p>
      <button type="submit" aria-disabled={pending ? true : undefined} className="btn btn-primary mt-4 aria-disabled:cursor-not-allowed aria-disabled:opacity-45">{pending ? copy.common.loading : copy.members.sendInvitations}</button>
    </form>
  );
}

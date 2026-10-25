"use client";

import { useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { copy, text } from "@/lib/copy";
import { inviteAction } from "./actions";

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function InviteForm({ groupId }: { groupId: string }) {
  const [emails, setEmails] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function add(raw: string) {
    const parsed = raw.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (parsed.some((email) => !validEmail.test(email))) {
      setMessage(copy.members.invalidEmails);
      return;
    }
    if (parsed.length) setMessage("");
    setEmails((current) => [...new Set([...current, ...parsed])]);
    setInput("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", " "].includes(event.key) && input.trim()) {
      event.preventDefault();
      add(input);
    } else if (event.key === "Backspace" && !input && emails.length) {
      setEmails(emails.slice(0, -1));
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (input.trim()) add(input);
    const pendingEmails = input.trim()
      ? [...new Set([...emails, ...input.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter((email) => validEmail.test(email))])]
      : emails;
    if (!pendingEmails.length || input.trim().split(/[\s,;]+/).some((email) => email && !validEmail.test(email))) {
      setMessage(copy.members.invalidEmails);
      return;
    }
    startTransition(async () => {
      const data = new FormData();
      data.set("groupId", groupId);
      pendingEmails.forEach((email) => data.append("emails", email));
      const result = await inviteAction(data);
      if (!result.ok) setMessage(result.message === "invalid" ? copy.members.invalidEmails : copy.members.inviteFailed);
      else {
        setEmails([]);
        setMessage(result.skipped ? text(copy.members.inviteSkipped, { count: result.skipped }) : copy.members.inviteSuccess);
      }
    });
  }

  return (
    <form onSubmit={submit} className="card mt-5 p-5">
      <input type="hidden" name="groupId" value={groupId} />
      <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.members.inviteTitle}</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{copy.members.inviteDescription}</p>
      <div className="field mt-3 flex min-h-12 flex-wrap items-center gap-2" onClick={(event) => event.currentTarget.querySelector("input")?.focus()}>
        {emails.map((email) => (
          <span key={email} className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-[13px] text-ink">
            {email}
            <button type="button" aria-label={text(copy.members.removeEmail, { email })} disabled={pending} onClick={() => setEmails(emails.filter((item) => item !== email))} className="text-ink-muted hover:text-ink">×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (input.trim()) add(input); }}
          placeholder={copy.members.invitePlaceholder}
          aria-label={copy.members.inviteAriaLabel}
          disabled={pending}
          className="min-w-[180px] flex-1 border-0 bg-transparent p-1 text-[14px] text-ink outline-none"
        />
      </div>
      {message ? <p role="status" className={`mt-2 text-[13px] ${message === copy.members.inviteFailed || message === copy.members.invalidEmails ? "text-danger" : "text-ink-soft"}`}>{message}</p> : null}
      <button type="submit" disabled={pending} className="btn btn-primary mt-4 disabled:opacity-60">{pending ? copy.common.loading : copy.members.sendInvitations}</button>
    </form>
  );
}

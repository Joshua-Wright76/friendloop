"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { changeMemberEmailAction } from "./actions";

/** A quiet link that opens one field: fixing an address is rare, and shouldn't crowd the row. */
export function ChangeMemberEmail({ groupId, membershipId, name }: { groupId: string; membershipId: string; name: string }) {
  const c = copy.members.changeEmail;
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  // The confirmation lives in this person's card, where the change was made.
  const [doneFor, setDoneFor] = useState<string | null>(null);
  const note = useRef<HTMLParagraphElement>(null);
  // The list re-sorts by address after a fix: follow this card so its confirmation stays in view.
  useEffect(() => {
    if (!doneFor) return;
    const timer = setTimeout(() => note.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 400);
    return () => clearTimeout(timer);
  }, [doneFor]);
  const [pending, startTransition] = useTransition();

  // Opening the form on a phone: bring its buttons up above the tab bar.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => form.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [open]);

  if (!open) {
    return (
      <div className="mt-2 text-[13px]">
        {doneFor ? (
          <p ref={note} role="status" className="notice settle mb-1 flex items-start gap-2 border bg-accent-soft px-3 py-2 text-[13.5px] leading-relaxed">
            <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-1 h-4 w-4 flex-none"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span className="wrap-any">{text(c.doneNote, { email: doneFor })}</span>
          </p>
        ) : null}
        <button type="button" className="link" aria-label={text(c.ariaLabel, { name })} onClick={() => { setOpen(true); setDoneFor(null); }}>
          {c.action}
        </button>
      </div>
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof changeMemberEmailAction>>;
      try {
        result = await changeMemberEmailAction(data);
      } catch {
        setError(c.failed);
        return;
      }
      if (result === "changed") {
        setDoneFor(String(data.get("email") ?? "").trim());
        setOpen(false);
        setError("");
        router.refresh();
        return;
      }
      setError(
        result === "invalid"
          ? c.invalid
          : result === "taken"
            ? c.taken
            : result === "limited"
              ? copy.members.limitedNotice
              : c.failed,
      );
    });
  }

  return (
    <form ref={form} onSubmit={submit} className="mt-2 flex flex-col gap-1.5" noValidate>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <label htmlFor={inputId} className="text-[13px] font-bold text-ink-soft">{c.label}</label>
      <input
        id={inputId}
        name="email"
        type="email"
        autoComplete="off"
        autoFocus
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="field min-h-11"
      />
      {error ? <p id={errorId} role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn btn-primary h-11 min-h-11 px-4 text-[13px]" aria-disabled={pending ? true : undefined}>{text(c.save, { name })}</button>
        <button type="button" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]" onClick={() => { setOpen(false); setError(""); }}>{c.cancel}</button>
      </div>
    </form>
  );
}

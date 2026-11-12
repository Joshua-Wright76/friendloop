"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { copy, text } from "@/lib/copy";
import { changeMemberEmailAction } from "./actions";

/** A quiet button that opens one field: fixing an address is rare, and shouldn't crowd the row. */
export function ChangeMemberEmail({ groupId, membershipId, name, onDone }: { groupId: string; membershipId: string; name: string; onDone: (email: string) => void }) {
  const c = copy.members.changeEmail;
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Opening the form on a phone: bring its buttons up above the tab bar.
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => form.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, [open]);

  if (!open) {
    return (
      <button type="button" className="btn btn-quiet ppl-action" aria-label={text(c.ariaLabel, { name })} onClick={() => setOpen(true)}>
        {c.action}
      </button>
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
        onDone(String(data.get("email") ?? "").trim());
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
    <form ref={form} onSubmit={submit} className="ppl-form" noValidate>
      <input type="hidden" name="groupId" value={groupId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <label htmlFor={inputId} className="ppl-label">{c.label}</label>
      <input
        id={inputId}
        name="email"
        type="email"
        autoComplete="off"
        autoFocus
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="field min-h-11 w-full"
      />
      {error ? <p id={errorId} role="alert" className="text-[13px] text-danger">{error}</p> : null}
      <div className="ppl-form__buttons">
        <button type="submit" className="btn btn-primary h-11 min-h-11 px-4 text-[13px]" aria-disabled={pending ? true : undefined}>{text(c.save, { name })}</button>
        <button type="button" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]" onClick={() => { setOpen(false); setError(""); }}>{c.cancel}</button>
      </div>
    </form>
  );
}

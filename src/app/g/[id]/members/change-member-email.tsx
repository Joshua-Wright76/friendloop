"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
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
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="mt-2 text-[13px]">
        <button type="button" className="link" aria-label={text(c.ariaLabel, { name })} onClick={() => setOpen(true)}>
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
        router.push(`/g/${groupId}/members?addressChanged=1`);
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
    <form onSubmit={submit} className="mt-2 flex flex-col gap-1.5" noValidate>
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
        <button type="submit" className="btn btn-primary h-11 min-h-11 px-4 text-[13px]" aria-disabled={pending ? true : undefined}>{c.save}</button>
        <button type="button" className="btn btn-quiet h-11 min-h-11 px-4 text-[13px]" onClick={() => { setOpen(false); setError(""); }}>{c.cancel}</button>
      </div>
    </form>
  );
}

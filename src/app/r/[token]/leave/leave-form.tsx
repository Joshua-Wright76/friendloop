"use client";

import { useState } from "react";
import Link from "next/link";
import { SafeForm } from "@/components/safe-form";
import { Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { leaveLoopAction } from "./actions";

/**
 * The leave question. An unticked box is answered beside the box, in the page's own
 * words, not by the browser's bubble; the action still refuses without it.
 */
export function LeaveForm({ token, groupName, serverError }: { token: string; groupName: string; serverError: boolean }) {
  const [missing, setMissing] = useState(false);

  return (
    <SafeForm
      action={leaveLoopAction}
      noValidate
      validate={(form) => {
        const box = form.elements.namedItem("confirm") as HTMLInputElement;
        if (box.checked) return true;
        setMissing(true);
        box.focus();
        return false;
      }}
      className="card border-danger/30 p-6 pt-8"
    >
      <Tape tone="stripe" position="left" />
      <input type="hidden" name="token" value={token} />
      <h1 className="text-ink">{text(copy.leave.title, { groupName })}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{copy.leave.body}</p>
      <p className="mt-3 text-[14px] text-ink-soft">
        {copy.leave.downloadFirst}{" "}
        <a href={`/r/${token}/export`} download className="font-bold text-ink underline decoration-line-strong underline-offset-4">
          {copy.leave.download}
        </a>
      </p>

      {serverError && !missing ? (
        <p role="alert" className="notice mt-4 border border-danger/40 bg-danger/10 px-4 py-3 text-[14px] text-danger">
          {copy.leave.confirmError}
        </p>
      ) : null}

      <label className="mt-5 flex min-h-11 items-start gap-3 text-[15px] leading-snug text-ink">
        <input
          type="checkbox"
          name="confirm"
          aria-invalid={missing ? "true" : undefined}
          aria-describedby={missing ? "leave-confirm-error" : undefined}
          onChange={(event) => { if (event.target.checked) setMissing(false); }}
          className="accent-[var(--danger)]"
        />
        <span>{text(copy.leave.confirmLabel, { groupName })}</span>
      </label>
      {missing ? (
        <p id="leave-confirm-error" role="alert" className="mt-1 text-[14px] font-bold leading-snug text-danger">
          {copy.leave.confirmInline}
        </p>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" className="btn btn-danger hover:opacity-90">{copy.leave.submit}</button>
        <Link href={`/r/${token}`} className="btn btn-quiet">{copy.leave.cancel}</Link>
      </div>
    </SafeForm>
  );
}

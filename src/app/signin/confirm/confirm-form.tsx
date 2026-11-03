"use client";

import { useSyncExternalStore } from "react";
import { confirmLink } from "./actions";
import { MAX_DISPLAY_NAME } from "@/lib/names";
import { copy } from "@/lib/copy";

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

/** Asks nothing extra, but submits the browser's zone so deadlines can be local. */
export function ConfirmForm({ token, name }: { token: string; name?: string | null }) {
  const timezone = useSyncExternalStore(subscribeToNothing, browserTimezone, () => "");

  return (
    <form action={confirmLink} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="timezone" value={timezone} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-soft">{copy.confirm.nameLabel}</span>
        <input
          name="name"
          maxLength={MAX_DISPLAY_NAME}
          autoComplete="given-name"
          defaultValue={name ?? undefined}
          placeholder={copy.confirm.namePlaceholder}
          className="field h-[46px] py-0"
        />
        <span className="text-[12px] leading-relaxed text-ink-muted">{copy.confirm.nameHint}</span>
      </label>
      <button type="submit" className="btn btn-primary w-full">
        {copy.confirm.submit}
      </button>
    </form>
  );
}

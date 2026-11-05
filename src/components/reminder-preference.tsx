"use client";

import { useId, useState } from "react";
import { copy } from "@/lib/copy";
import { saveReminderPreference } from "@/lib/reply-client";
import type { ReminderPreference as Preference } from "@/lib/reminders";

const OPTIONS: Preference[] = ["all", "last", "none"];

type Status = "idle" | "saving" | "saved" | "error";

/**
 * A quiet "how often should the loop nudge me" control. It saves the moment you
 * choose, over the reply token, and never touches what the owner can do by hand.
 */
export function ReminderPreference({ token, initial }: { token: string; initial: Preference }) {
  const [value, setValue] = useState<Preference>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const hintId = useId();
  const labels = copy.reply.reminders;

  async function choose(next: Preference) {
    const previous = value;
    setValue(next);
    setStatus("saving");
    const result = await saveReminderPreference(token, next, labels.error);
    if (result.ok) {
      setStatus("saved");
    } else {
      setValue(previous);
      setStatus("error");
    }
  }

  return (
    <section id="reminders" className="mt-3 scroll-mt-20 border-t border-dashed border-line pt-3">
      <fieldset aria-describedby={hintId}>
        <legend className="text-[14px] font-bold text-ink-soft">{labels.legend}</legend>
        <div className="mt-2 flex flex-col gap-1">
          {OPTIONS.map((option) => (
            <label key={option} className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] text-ink">
              <input
                type="radio"
                name="reminder-preference"
                value={option}
                checked={value === option}
                onChange={() => void choose(option)}
                className="h-5 w-5 accent-[var(--accent)]"
              />
              {labels[option]}
            </label>
          ))}
        </div>
      </fieldset>
      <p id={hintId} className="mt-1 text-[12px] leading-relaxed text-ink-muted">{labels.hint}</p>
      <p aria-live="polite" className={`mt-1 text-[12px] empty:hidden ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
        {status === "saving" ? labels.saving : status === "saved" ? labels.saved : status === "error" ? labels.error : ""}
      </p>
    </section>
  );
}

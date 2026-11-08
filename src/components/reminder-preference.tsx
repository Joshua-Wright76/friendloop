"use client";

import { useId, useState } from "react";
import { copy } from "@/lib/copy";
import { saveReminderPreference } from "@/lib/reply-client";
import { remindersOn, type ReminderPreference as Preference } from "@/lib/reminders";

type Status = "idle" | "saving" | "saved" | "error";

/**
 * One quiet switch: does the loop remind me before it goes out? It saves the
 * moment it is flipped, over the reply token, and never touches what the owner
 * can do by hand.
 */
export function ReminderPreference({ token, initial }: { token: string; initial: Preference }) {
  const [on, setOn] = useState(remindersOn(initial));
  const [status, setStatus] = useState<Status>("idle");
  const hintId = useId();
  const labels = copy.reply.reminders;

  async function flip(next: boolean) {
    setOn(next);
    setStatus("saving");
    const result = await saveReminderPreference(token, next ? "all" : "none", labels.error);
    if (result.ok) {
      setStatus("saved");
    } else {
      setOn(!next);
      setStatus("error");
    }
  }

  return (
    <section id="reminders" className="mt-3 scroll-mt-20 border-t border-dashed border-line pt-3">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] font-bold text-ink">
        <input
          type="checkbox"
          role="switch"
          name="reminders"
          checked={on}
          aria-describedby={hintId}
          onChange={(event) => void flip(event.target.checked)}
          className="h-5 w-5 accent-[var(--accent)]"
        />
        {labels.label}
      </label>
      <p id={hintId} className="mt-1 text-[13px] leading-relaxed text-ink-muted">{labels.hint}</p>
      <p aria-live="polite" className={`mt-1 text-[13px] empty:hidden ${status === "error" ? "text-danger" : "text-ink-muted"}`}>
        {status === "saving" ? labels.saving : status === "saved" ? labels.saved : status === "error" ? labels.error : ""}
      </p>
    </section>
  );
}

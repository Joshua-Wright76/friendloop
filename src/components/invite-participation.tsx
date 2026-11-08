"use client";

import { useId } from "react";
import { copy } from "@/lib/copy";

export type Participation = "contributor" | "reader";

const OPTIONS: Participation[] = ["contributor", "reader"];

/**
 * Answers or just reads, chosen when inviting, so the invitation (and every email
 * after it) already fits the person: a reader is never asked to answer a round.
 */
export function InviteParticipation({
  value,
  onChange,
  disabled = false,
  className = "",
}: {
  value: Participation;
  onChange: (next: Participation) => void;
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  const labels = copy.members.inviteAs;
  return (
    <fieldset className={`invite-participation ${className}`}>
      <legend className="text-[13px] font-bold text-ink-soft">{labels.legend}</legend>
      <div className="mt-1 flex flex-wrap gap-x-5">
        {OPTIONS.map((option) => (
          <label key={option} className="flex min-h-11 cursor-pointer items-center gap-2 text-[14px] text-ink">
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              aria-disabled={disabled ? true : undefined}
              onChange={() => {
                if (!disabled) onChange(option);
              }}
            />
            {labels[option]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

"use client";

import { useRef } from "react";
import { Tape } from "@/components/stationery";
import { copy } from "@/lib/copy";

export type PollCardStatus = "idle" | "saving" | "saved" | "cleared" | "error";

type Props = {
  id: string;
  index: number;
  prompt: string;
  options: string[];
  multiple: boolean;
  picks: number[];
  status: PollCardStatus;
  disabled: boolean;
  onChange: (next: number[]) => void;
};

/**
 * A poll on the reply sheet: tap to choose, change your mind until the round goes
 * out. Nothing here shows what anyone else picked — results arrive with the issue.
 */
export function PollCard({ id, index, prompt, options, multiple, picks, status, disabled, onChange }: Props) {
  const firstOption = useRef<HTMLInputElement>(null);
  const toggle = (option: number) => {
    if (multiple) {
      onChange(picks.includes(option) ? picks.filter((pick) => pick !== option) : [...picks, option].sort((a, b) => a - b));
    } else {
      onChange([option]);
    }
  };

  return (
    <section data-paper="poll" className="card paper ride-in block p-5 pt-7">
      <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={disabled}>
        <legend className="mb-1 w-full p-0 font-display text-[25px] font-bold leading-[1.15] text-ink">{prompt}</legend>
        <p className="mb-3 text-[13px] font-medium text-ink-muted">
          {multiple ? copy.polls.sheet.multiple : copy.polls.sheet.single}
        </p>
        <div className="flex flex-col gap-2">
          {options.map((option, optionIndex) => (
            <label key={option} className="poll-option">
              <input
                ref={optionIndex === 0 ? firstOption : undefined}
                type={multiple ? "checkbox" : "radio"}
                name={`poll-${id}`}
                checked={picks.includes(optionIndex)}
                onChange={() => toggle(optionIndex)}
                className="h-5 w-5 flex-none accent-accent"
              />
              <span className="min-w-0 text-[15px] font-semibold leading-snug text-ink">{option}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-muted" aria-live="polite">
          {status === "saving" ? copy.polls.sheet.saving : null}
          {status === "saved" ? copy.polls.sheet.saved : null}
          {status === "cleared" ? copy.polls.sheet.cleared : null}
          {status === "error" ? (
            <>
              {copy.polls.sheet.error}{" "}
              <button type="button" className="link link--inline cursor-pointer" onClick={() => onChange(picks)}>{copy.polls.sheet.retry}</button>
            </>
          ) : null}
          {status === "idle" ? copy.polls.sheet.hidden : null}
        </p>
        {picks.length > 0 ? (
          <button
            type="button"
            aria-disabled={disabled ? true : undefined}
            onClick={() => {
              if (disabled) return;
              // Clear leaves with the picks; the first option is where the keyboard carries on.
              firstOption.current?.focus();
              onChange([]);
            }}
            className="btn btn-quiet min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            {copy.polls.sheet.clear}
          </button>
        ) : null}
      </div>
    </section>
  );
}

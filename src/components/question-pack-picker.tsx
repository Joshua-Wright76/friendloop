"use client";

import { useId, useState } from "react";
import type { QuestionPack } from "@/lib/question-packs";
import { visiblePacks } from "@/lib/question-packs";
import { copy, text } from "@/lib/copy";

type Props = {
  packs: QuestionPack[];
  selected: string[];
  onToggleQuestion: (question: string) => void;
  onTogglePack: (questions: string[], select: boolean) => void;
  ariaLabel: string;
};

/**
 * Browse the question library by pack. Filters show any combination of packs;
 * selections survive filtering, so questions can come from several packs at once.
 */
export function QuestionPackPicker({
  packs,
  selected,
  onToggleQuestion,
  onTogglePack,
  ariaLabel,
}: Props) {
  const [active, setActive] = useState<string[]>([]);
  const headingId = useId();
  const visible = visiblePacks(packs, active);
  const chosen = new Set(selected);

  const toggleFilter = (packId: string) => {
    setActive((current) =>
      current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId],
    );
  };

  return (
    <div className="mt-4">
      <div role="group" aria-label={copy.questions.filterLabel} className="flex flex-wrap gap-1.5">
        <FilterChip
          pressed={active.length === 0}
          label={copy.questions.filterAll}
          onClick={() => setActive([])}
        />
        {packs.map((pack) => (
          <FilterChip
            key={pack.id}
            pressed={active.includes(pack.id)}
            label={pack.name}
            onClick={() => toggleFilter(pack.id)}
          />
        ))}
      </div>

      <h3 id={headingId} className="sr-only">{ariaLabel}</h3>
      <div className="mt-3 flex flex-col gap-3" role="group" aria-labelledby={headingId}>
        {visible.map((pack) => {
          const allPicked = pack.questions.every((question) => chosen.has(question));
          return (
            <section key={pack.id} className="card p-3 sm:p-4" role="group" aria-label={pack.name}>
              <div className="flex items-center justify-between gap-2 px-2">
                <h4 className="font-display text-[20px] font-bold text-ink">{pack.name}</h4>
                <button
                  type="button"
                  aria-label={text(
                    allPicked ? copy.questions.packRemoveAllLabel : copy.questions.packAddAllLabel,
                    { pack: pack.name },
                  )}
                  onClick={() => onTogglePack(pack.questions, !allPicked)}
                  className="btn btn-quiet h-8 min-h-8 px-3 text-[13px]"
                >
                  {allPicked ? copy.questions.packRemoveAll : copy.questions.packAddAll}
                </button>
              </div>
              <div className="flex flex-col">
                {pack.questions.map((question) => (
                  <label key={question} className="wizard-question-row">
                    <input
                      type="checkbox"
                      checked={chosen.has(question)}
                      onChange={() => onToggleQuestion(question)}
                      className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]"
                    />
                    <span className="text-[15px] leading-snug text-ink">{question}</span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FilterChip({ pressed, label, onClick }: { pressed: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        pressed
          ? "border-accent-line bg-accent-soft text-accent-ink"
          : "border-line text-ink-soft hover:bg-field"
      }`}
    >
      {label}
    </button>
  );
}

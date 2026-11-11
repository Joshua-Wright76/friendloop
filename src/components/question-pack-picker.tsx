"use client";

import { useId, useState } from "react";
import type { QuestionPack } from "@/lib/question-packs";
import { packStatus } from "@/lib/question-packs";
import { copy, text } from "@/lib/copy";

type Props = {
  packs: QuestionPack[];
  selected: string[];
  onToggleQuestion: (question: string) => void;
  onTogglePack: (questions: string[], select: boolean) => void;
  ariaLabel: string;
  /** Questions the loop already asks. They show ticked and fixed, and "Add all" leaves them out. */
  inPool?: string[];
  /** Level of the visually hidden heading; pack names sit one level below it. */
  headingLevel?: 2 | 3;
};

/**
 * Browse the question library by pack. Each pack folds away to a single row with
 * its counts, and they all start folded, so the library reads as a short
 * list. Picks survive folding, so questions can come from several packs at once.
 */
export function QuestionPackPicker({
  packs,
  selected,
  onToggleQuestion,
  onTogglePack,
  ariaLabel,
  inPool = [],
  headingLevel = 3,
}: Props) {
  const ListHeading = `h${headingLevel}` as "h2" | "h3";
  const PackHeading = `h${headingLevel + 1}` as "h3" | "h4";
  // Every pack starts folded, except one the person has already picked from: the list of themes is the first thing to read.
  const [open, setOpen] = useState<string[]>([]);
  const headingId = useId();
  const panelPrefix = useId();
  const chosen = new Set(selected);
  const pooled = new Set(inPool);

  const toggleOpen = (packId: string) => {
    setOpen((current) =>
      current.includes(packId) ? current.filter((id) => id !== packId) : [...current, packId],
    );
  };

  return (
    <div className="mt-4">
      <ListHeading id={headingId} className="sr-only">{ariaLabel}</ListHeading>
      <div className="flex flex-col gap-2" role="group" aria-labelledby={headingId}>
        {packs.map((pack) => {
          const status = packStatus(pack, selected, inPool);
          const expanded = open.includes(pack.id);
          const panelId = `${panelPrefix}-${pack.id}`;
          const counts = [
            text(copy.questions.packQuestionCount, { count: pack.questions.length }),
            status.inPool > 0 ? text(copy.questions.packInPool, { count: status.inPool }) : null,
            status.picked > 0 ? text(copy.questions.packPicked, { count: status.picked }) : null,
          ].filter(Boolean).join(" · ");
          return (
            <section key={pack.id} className="card pack-card" role="group" aria-label={pack.name}>
              <div className="flex items-center justify-between gap-2">
                <PackHeading className="min-w-0 flex-1">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() => toggleOpen(pack.id)}
                    className="pack-toggle"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="pack-chevron">
                      <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span className="min-w-0">
                      <span className="pack-name">{pack.name}</span>
                      <span className="block font-sans text-[13px] font-medium text-ink-muted numeric">{counts}</span>
                    </span>
                  </button>
                </PackHeading>
                {status.addable.length > 0 ? (
                  <button
                    type="button"
                    aria-label={text(
                      status.allPicked ? copy.questions.packRemoveAllLabel : copy.questions.packAddAllLabel,
                      { pack: pack.name },
                    )}
                    onClick={() => onTogglePack(status.addable, !status.allPicked)}
                    className="link link--quiet pack-addall"
                  >
                    {status.allPicked ? copy.questions.packRemoveAll : copy.questions.packAddAll}
                  </button>
                ) : null}
              </div>
              <div id={panelId} hidden={!expanded} className="mt-1 flex flex-col">
                {pack.questions.map((question) => {
                  const already = pooled.has(question);
                  return (
                    <label key={question} className={`wizard-question-row ${already ? "is-in-pool" : ""}`}>
                      <input
                        type="checkbox"
                        checked={already || chosen.has(question)}
                        disabled={already}
                        onChange={() => onToggleQuestion(question)}
                        className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink">
                        {question}
                        {already ? (
                          <span className="pool-tag">{copy.questions.inPoolTag}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

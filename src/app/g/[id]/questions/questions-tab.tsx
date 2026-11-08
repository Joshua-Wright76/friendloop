"use client";

import { useEffect, useRef, useState } from "react";
import { AutoPicker } from "@/components/auto-picker";
import { FieldLabel } from "@/components/field-label";
import { IconTrash } from "@/components/icon-trash";
import { LoopNav } from "@/components/loop-nav";
import { NoticeFocus } from "@/components/notice-focus";
import { QuestionPackPicker } from "@/components/question-pack-picker";
import { SafeForm } from "@/components/safe-form";
import { SortableList } from "@/components/sortable-list";
import { SubmitButton } from "@/components/submit-button";
import { copy, text } from "@/lib/copy";
import { formatDate, formatMoment } from "@/lib/format";
import { QUESTION_PACKS, newQuestionTexts } from "@/lib/question-packs";
import type { AskFrequency } from "@/lib/asks";
import { useLoopData, type PageItem, type RoundItem } from "../loop-data";
import {
  acceptSuggestionAction,
  addFromPacksAction,
  addItemAction,
  askAgainAction,
  declineSuggestionAction,
  removeFromRoundAction,
  reorderListAction,
  reorderRoundAction,
  rotationAction,
} from "./actions";
import { ItemEditor, ItemLabel, ItemRow, itemTags } from "./item-row";
import { ItemFields } from "./item-fields";

const COUNT_OPTIONS = [
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
  { value: "", label: copy.questions.upNext.countAll },
];

type Notices = { done?: string; problem?: string; fromPacks?: string; suggestion?: string };

/**
 * The Questions page (docs/questions-unify-design.md): the round, not the setup.
 * "This round asks" leads, edited directly; "Up next" follows with the queue, the
 * every-round items and the dates; then one card adds any kind of item.
 */
export default function QuestionsTab({ notices }: { notices: Notices }) {
  const { group, membership, questionsPage: page, suggestions } = useLoopData();
  const manages = membership.access !== "member";
  // "Add to this round" in the round's card asks the add card for this round, and takes you there.
  const [addNow, setAddNow] = useState(0);
  const [thisRound, setThisRound] = useState(false);
  const suggestionsRef = useRef<HTMLDetailsElement>(null);
  // The overview links here with #suggestions: open the list it points at.
  useEffect(() => {
    if (window.location.hash === "#suggestions" && suggestionsRef.current) {
      suggestionsRef.current.open = true;
      suggestionsRef.current.scrollIntoView({ block: "start" });
    }
  }, []);

  const everything = [...page.queue, ...page.everyRound, ...page.dated];
  const inThisRound = new Set(page.thisRound.flatMap((row) => (row.questionId ? [row.questionId] : [])));

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={group.id} name={group.name} access={membership.access} active="Questions">
        <h1>{copy.questions.title}</h1>
        <p>{manages ? copy.questions.description : copy.questions.memberDescription}</p>
      </LoopNav>

      <PageNotices notices={notices} />
      {group.pausedAt ? (
        <p className="notice mt-4 border bg-card px-4 py-3 text-[14px] font-bold leading-relaxed text-ink">
          {page.round ? copy.questions.pausedNote : copy.questions.pausedNoRound}
        </p>
      ) : null}

      <div className="questions-grid">
        <div className="questions-grid__main">
          <ThisRound everything={everything} manages={manages} onAdd={() => { setThisRound(true); setAddNow((count) => count + 1); }} />
          <UpNext manages={manages} inThisRound={inThisRound} />
        </div>
        {manages ? (
          <div className="questions-grid__side">
            <AddCard request={addNow} thisRound={thisRound} onThisRound={setThisRound} packsOpen={notices.fromPacks !== undefined} />
            {suggestions.length > 0 ? <Suggestions refObject={suggestionsRef} open={Boolean(notices.suggestion)} /> : null}
            {page.stopped.length > 0 ? <Stopped items={page.stopped} /> : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

function PageNotices({ notices }: { notices: Notices }) {
  const done = notices.done && notices.done in copy.questions.done ? copy.questions.done[notices.done as keyof typeof copy.questions.done] : null;
  const problem = notices.problem && notices.problem in copy.questions.errors ? copy.questions.errors[notices.problem as keyof typeof copy.questions.errors] : null;
  const packs = notices.fromPacks === undefined
    ? null
    : notices.fromPacks === "0"
      ? copy.questions.fromPacksNone
      : notices.fromPacks === "1"
        ? copy.questions.fromPacksAddedOne
        : text(copy.questions.fromPacksAdded, { count: notices.fromPacks });
  const suggestion = notices.suggestion === "added"
    ? copy.questions.suggestionAddedNotice
    : notices.suggestion === "declined"
      ? copy.questions.suggestionDeclinedNotice
      : notices.suggestion === "gone"
        ? copy.questions.suggestionGoneNotice
        : null;
  const message = done ?? packs ?? suggestion;
  return (
    <>
      {message ? <NoticeFocus key={message}>{message}</NoticeFocus> : null}
      {problem ? <NoticeFocus key={problem} tone="danger">{problem}</NoticeFocus> : null}
    </>
  );
}

function roundTag(round: { number: number; deliversAt: Date } | null, timezone: string): string {
  return round ? text(copy.questions.upNext.roundTag, { number: round.number, date: formatDate(round.deliversAt, timezone) }) : copy.questions.upNext.later;
}

function frequencyTag(row: RoundItem): string | null {
  if (row.occurrenceLabel) return row.occurrenceLabel;
  return row.frequency ? copy.questions.item.frequencies[row.frequency] : null;
}

function writtenNote(writers: string[]): string {
  return writers.length === 1
    ? text(copy.questions.thisRound.writtenOne, { name: writers[0] })
    : text(copy.questions.thisRound.writtenMany, { name: writers[0], count: writers.length - 1 });
}

/** The open round's items, in its order: reordered, removed and added to directly. */
function ThisRound({ everything, manages, onAdd }: { everything: PageItem[]; manages: boolean; onAdd: () => void }) {
  const { group, user, questionsPage: page } = useLoopData();
  const [editing, setEditing] = useState<string | null>(null);
  const round = page.round;
  const when = round ? formatMoment(round.deliversAt, user.timezone || group.timezone) : "";

  return (
    <section className="card mt-4 p-4 sm:p-5" aria-labelledby="this-round-title">
      <div className="section-head">
        <h2 id="this-round-title" className="text-ink">{copy.questions.thisRound.title}</h2>
        {round ? (
          <p className="m-0 text-[13.5px] font-bold text-ink-soft numeric">
            {round.name
              ? text(copy.questions.thisRound.metaNamed, { name: round.name, when })
              : text(copy.questions.thisRound.meta, { number: round.number, when })}
          </p>
        ) : null}
      </div>

      {!round ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{copy.questions.thisRound.none}</p>
      ) : page.thisRound.length === 0 ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{copy.questions.thisRound.empty}</p>
      ) : (
        <div className="mt-3">
          <SortableList
            items={page.thisRound}
            label={copy.questions.thisRound.listLabel}
            nameOf={(row) => row.text}
            disabled={!manages}
            rowClassName="list-row"
            move={(id, index) => reorderRoundAction(group.id, id, index)}
          >
            {(row, index) => {
              const item = row.questionId ? everything.find((candidate) => candidate.id === row.questionId) : undefined;
              const tags = itemTags(row, [frequencyTag(row)]);
              const content = (
                <>
                  <span className="question-number numeric" aria-hidden="true">{index + 1}</span>
                  <span className="item-main">
                    <ItemLabel emoji={row.emoji} label={row.text} />
                    {tags ? <span className="item-meta numeric">{tags}</span> : null}
                  </span>
                </>
              );
              return (
                <>
                  <div className="row-line">
                    {manages && item ? (
                      <button
                        type="button"
                        className="item-row item-row--button"
                        aria-expanded={editing === row.id}
                        aria-label={text(copy.questions.item.editLabel, { item: row.text })}
                        onClick={() => setEditing((current) => (current === row.id ? null : row.id))}
                      >
                        {content}
                      </button>
                    ) : (
                      <div className="item-row">{content}</div>
                    )}
                    {!manages ? null : row.writers.length > 0 ? (
                      <p className="row-reason">{writtenNote(row.writers)}</p>
                    ) : (
                      <SafeForm action={removeFromRoundAction} className="flex-none">
                        <input type="hidden" name="groupId" value={group.id} />
                        <input type="hidden" name="snapshotId" value={row.id} />
                        <input type="hidden" name="turn" value={row.frequency === "rotating" && group.questionsPerRound !== null ? "1" : "0"} />
                        <SubmitButton aria-label={text(copy.questions.thisRound.removeLabel, { item: row.text })} title={copy.questions.thisRound.remove} className="row-icon row-icon--danger">
                          <IconTrash />
                        </SubmitButton>
                      </SafeForm>
                    )}
                  </div>
                  {item && editing === row.id ? <ItemEditor item={item} groupId={group.id} inThisRound /> : null}
                </>
              );
            }}
          </SortableList>
        </div>
      )}

      {manages && round ? (
        <button type="button" onClick={onAdd} className="btn btn-quiet mt-3 min-h-11 px-4 text-[14px]">
          <span aria-hidden="true" className="mr-1.5">+</span>{copy.questions.thisRound.add}
        </button>
      ) : null}
    </section>
  );
}

/** What comes after this round: the queue, the every-round items, and the dates. */
function UpNext({ manages, inThisRound }: { manages: boolean; inThisRound: Set<string> }) {
  const { group, questionsPage: page } = useLoopData();
  const count = group.questionsPerRound;
  const pollLine = (item: PageItem) => item.format === "poll" && item.pollOptions?.length
    ? <span className="poll-line block">{item.pollOptions.join(", ")}</span>
    : null;

  return (
    <section className="card mt-4 p-4 sm:p-5" aria-labelledby="up-next-title">
      <h2 id="up-next-title" className="text-ink">{copy.questions.upNext.title}</h2>

      <h3 className="subhead list-head">{copy.questions.upNext.turnsTitle}</h3>
      {page.queue.length > 0 && manages ? (
        <SafeForm action={rotationAction} className="count-line">
          <input type="hidden" name="groupId" value={group.id} />
          <span>{copy.questions.upNext.countBefore}</span>
          <AutoPicker name="questionsPerRound" defaultValue={count?.toString() ?? ""} options={COUNT_OPTIONS} ariaLabel={copy.questions.upNext.countLabel} />
          <span>{copy.questions.upNext.countAfter}</span>
        </SafeForm>
      ) : null}
      {page.queue.length > 0 ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{count === null ? copy.questions.upNext.turnsAllHelp : copy.questions.upNext.turnsHelp}</p>
          <div className="mt-2">
            <SortableList
              items={page.queue}
              label={copy.questions.upNext.turnsLabel}
              nameOf={(item) => item.label}
              disabled={!manages}
              rowClassName="list-row"
              move={(id, index) => reorderListAction(group.id, "rotating", id, index)}
            >
              {(item, index) => (
                <ItemRow item={item} groupId={group.id} number={index + 1} tag={roundTag(item.firstRound, group.timezone)} inThisRound={inThisRound.has(item.id)} manages={manages} poll={pollLine(item)} />
              )}
            </SortableList>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.turnsEmpty}</p>
      )}

      <h3 className="subhead list-head">{copy.questions.upNext.everyRoundTitle}</h3>
      {page.everyRound.length > 0 ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{copy.questions.upNext.everyRoundHelp}</p>
          <div className="mt-2">
            <SortableList
              items={page.everyRound}
              label={copy.questions.upNext.everyRoundLabel}
              nameOf={(item) => item.label}
              disabled={!manages}
              rowClassName="list-row"
              move={(id, index) => reorderListAction(group.id, "every_round", id, index)}
            >
              {(item) => <ItemRow item={item} groupId={group.id} inThisRound={inThisRound.has(item.id)} manages={manages} poll={pollLine(item)} />}
            </SortableList>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.everyRoundEmpty}</p>
      )}

      {manages ? (
        <>
          <h3 className="subhead list-head">{copy.questions.upNext.datedTitle}</h3>
          {page.dated.length > 0 ? (
            <>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{copy.questions.upNext.datedHelp}</p>
              <ul className="plain-list mt-2" aria-label={copy.questions.upNext.datedLabel}>
                {page.dated.map((item) => (
                  <li key={item.id} className="list-row list-row--still">
                    <ItemRow
                      item={item}
                      groupId={group.id}
                      tag={[
                        item.nextLabel ?? copy.questions.upNext.passed,
                        item.dateKind === "birthday" ? copy.questions.upNext.yearly : null,
                        item.firstRound ? text(copy.questions.upNext.roundShort, { number: item.firstRound.number }) : null,
                      ].filter(Boolean).join(" · ")}
                      inThisRound={inThisRound.has(item.id)}
                      manages
                    />
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.datedEmpty}</p>
          )}
        </>
      ) : null}
    </section>
  );
}

/** One card for any kind of item, with the question packs folded beneath. */
function AddCard({ request, thisRound, onThisRound, packsOpen }: { request: number; thisRound: boolean; onThisRound: (value: boolean) => void; packsOpen: boolean }) {
  const { group, questionsPage: page } = useLoopData();
  const form = useRef<HTMLFormElement>(null);
  const [frequency, setFrequency] = useState<AskFrequency>(page.queue.length > 0 || group.questionsPerRound !== null ? "rotating" : "every_round");
  const [picked, setPicked] = useState<string[]>([]);
  const poolTexts = [...page.queue, ...page.everyRound].map((item) => item.text);
  // Picks the loop already asks (say, just added) never count or travel with the form.
  const fresh = newQuestionTexts(picked, poolTexts);

  useEffect(() => {
    if (request === 0) return;
    form.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    form.current?.querySelector<HTMLInputElement>("input[name=text]")?.focus({ preventScroll: true });
  }, [request]);

  return (
    <section id="add-item" className="card mt-4 p-4 sm:p-5" aria-labelledby="add-item-title">
      <h2 id="add-item-title" className="text-ink">{copy.questions.add.title}</h2>
      <SafeForm ref={form} action={addItemAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="groupId" value={group.id} />
        <ItemFields defaultFrequency={frequency} onFrequencyChange={setFrequency} />
        {page.round ? (
          <div>
            <label className="flex min-h-11 items-center gap-2 text-[14px] font-bold text-ink">
              <input type="checkbox" name="thisRound" checked={thisRound} onChange={(event) => onThisRound(event.target.checked)} className="h-5 w-5 accent-accent" />
              {copy.questions.add.thisRound}
            </label>
            {frequency === "rotating" ? null : <p className="m-0 text-[13px] leading-relaxed text-ink-muted">{copy.questions.add.thisRoundHint}</p>}
          </div>
        ) : null}
        <div>
          <SubmitButton className="btn btn-primary">{copy.questions.add.submit}</SubmitButton>
        </div>
      </SafeForm>

      {/* Back from adding some, the library stays open for the next pick. */}
      <details className="fold stitched-top mt-4 pt-2" open={packsOpen || undefined}>
        <summary>
          <svg viewBox="0 0 20 20" aria-hidden="true" className="fold-chevron">
            <path d="M7 4.5 12.5 10 7 15.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {copy.questions.add.packsSummary}
        </summary>
        <SafeForm action={addFromPacksAction} className="mt-1">
          <input type="hidden" name="groupId" value={group.id} />
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.packsDescription}</p>
          <div className="pack-addbar" data-active={fresh.length > 0 ? "" : undefined}>
            <span className="text-[14px] font-bold text-ink-soft numeric">{text(copy.common.selectedCount, { count: fresh.length })}</span>
            {/* aria-disabled, not disabled: the button stays reachable and says why nothing happens yet. */}
            <SubmitButton blocked={fresh.length === 0} className="btn btn-primary min-h-11 px-5 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45">
              {copy.questions.addToPool}
            </SubmitButton>
          </div>
          <QuestionPackPicker
            packs={QUESTION_PACKS}
            selected={picked}
            inPool={poolTexts}
            onToggleQuestion={(question) => setPicked((current) => current.includes(question) ? current.filter((item) => item !== question) : [...current, question])}
            onTogglePack={(questions, select) => setPicked((current) => select
              ? [...current, ...questions.filter((question) => !current.includes(question))]
              : current.filter((question) => !questions.includes(question)))}
            ariaLabel={copy.questions.packsTitle}
          />
          {fresh.map((question) => <input key={question} type="hidden" name="question" value={question} />)}
        </SafeForm>
      </details>
    </section>
  );
}

function Suggestions({ refObject, open }: { refObject: React.RefObject<HTMLDetailsElement | null>; open: boolean }) {
  const { group, suggestions } = useLoopData();
  return (
    <details id="suggestions" ref={refObject} className="card plain-details mt-4 px-4 py-1.5" aria-label={copy.questions.suggestionsTitle} open={open ? true : undefined}>
      <summary className="pool-summary min-h-11 cursor-pointer">
        <span className="text-[15px] font-extrabold text-ink numeric">
          {suggestions.length === 1 ? copy.questions.suggestionsNoticeOne : text(copy.questions.suggestionsNotice, { count: suggestions.length })}
        </span>
        <span className="link">{copy.questions.review}</span>
      </summary>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.suggestionsDescription}</p>
      <ul className="mb-3 mt-3 flex flex-col gap-3">
        {suggestions.map((suggestion) => (
          <li key={suggestion.id} className="rounded-md border border-dashed border-accent-line bg-accent-soft p-4">
            <p className="text-[12.5px] font-medium text-ink-muted numeric">
              {text(copy.questions.suggestionAuthor, { name: suggestion.authorName ?? suggestion.authorEmail.split("@")[0] })}
              {suggestion.authorDisplay === "anonymous" ? (
                <span className="ml-2 chip border bg-card px-2 py-0.5 text-[13px] text-ink-soft">{copy.questions.suggestionAnonymous}</span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SafeForm action={acceptSuggestionAction} className="contents">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="suggestionId" value={suggestion.id} />
                <label className="flex basis-full flex-col gap-1.5">
                  <FieldLabel required>{copy.questions.suggestionTextLabel}</FieldLabel>
                  <textarea name="text" required rows={2} maxLength={200} defaultValue={suggestion.text} className="field min-h-[72px]" />
                </label>
                <SubmitButton className="btn btn-primary min-h-11 px-4 text-[14px]">{copy.questions.suggestionSave}</SubmitButton>
              </SafeForm>
              <SafeForm action={declineSuggestionAction} className="contents">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="suggestionId" value={suggestion.id} />
                <SubmitButton className="btn btn-quiet min-h-11 px-4 text-[14px]">{copy.questions.suggestionDecline}</SubmitButton>
              </SafeForm>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What the loop stopped asking, folded away, each ready to ask again. */
function Stopped({ items }: { items: PageItem[] }) {
  const { group } = useLoopData();
  return (
    <details className="card plain-details mt-4 px-4 py-1.5">
      <summary className="pool-summary min-h-11 cursor-pointer">
        <span className="text-[15px] font-extrabold text-ink numeric">{text(copy.questions.item.stoppedTitle, { count: items.length })}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <ul className="plain-list mb-3 mt-2" aria-label={copy.questions.item.stoppedLabel}>
        {items.map((item) => (
          <li key={item.id} className="list-row list-row--still">
            <div className="row-line">
              <div className="item-row">
                <span className="item-main">
                  <ItemLabel emoji={item.emoji} label={item.label} />
                  <span className="item-meta">{itemTags(item, [copy.questions.item.frequencies[item.frequency]])}</span>
                </span>
              </div>
              <SafeForm action={askAgainAction} className="flex-none">
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="questionId" value={item.id} />
                <SubmitButton aria-label={text(copy.questions.item.askAgainLabel, { item: item.label })} className="btn btn-quiet min-h-11 px-4 text-[14px]">
                  {copy.questions.item.askAgain}
                </SubmitButton>
              </SafeForm>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

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
import { atMoment, formatDate, formatMoment } from "@/lib/format";
import { QUESTION_PACKS, newQuestionTexts } from "@/lib/question-packs";
import type { AskFrequency } from "@/lib/asks";
import { useLoopData, type PageItem, type QuestionsPage } from "../loop-data";
import {
  acceptSuggestionAction,
  addFromPacksAction,
  addItemAction,
  askAgainAction,
  askThisRoundAction,
  declineSuggestionAction,
  reorderListAction,
  reorderRoundAction,
  rotationAction,
} from "./actions";
import { AskNowButton, ItemEditor, ItemLabel, ItemRow, RemovePanel, itemTags } from "./item-row";
import { ScrollToDone } from "./scroll-to-done";
import { ItemFields } from "./item-fields";

const COUNT_OPTIONS = [
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
  { value: "", label: copy.questions.upNext.countAll },
];

type Notices = { done?: string; problem?: string; fromPacks?: string; suggestion?: string; undo?: string; q?: string };

/** Where a confirmation shows: beside what changed, or at the top when nothing on the page is that. */
type Where = "round-row" | "up-row" | "stopped-row" | "round" | "count" | "top";
type Inline = { where: Where; qid: string | null; message: string; undo: string | null };

function noticeMessage(notices: Notices): string | null {
  const done = notices.done && notices.done in copy.questions.done ? copy.questions.done[notices.done as keyof typeof copy.questions.done] : null;
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
  return done ?? packs ?? suggestion;
}

/** The place a change happened, found from what the URL says and what the page now holds. */
function placeNotice(notices: Notices, page: QuestionsPage, everything: PageItem[]): Inline | null {
  const message = noticeMessage(notices);
  if (!message) return null;
  const qid = notices.q ?? null;
  const undo = notices.done?.startsWith("removed") ? notices.undo ?? null : null;
  const inRound = qid !== null && page.thisRound.some((row) => row.questionId === qid);
  // "everything" here is what the page lists outside the round: a row to point at only if it's in it.
  const inUp = qid !== null && everything.some((item) => item.id === qid);
  const inStopped = qid !== null && page.stopped.some((item) => item.id === qid);
  let where: Where = "top";
  switch (notices.done) {
    case "addedNow":
    case "alreadyAsked":
    case "stoppedStays":
      where = inRound ? "round-row" : "top";
      break;
    case "added":
    case "again":
      where = inUp ? "up-row" : inRound ? "round-row" : "top";
      break;
    case "saved":
      where = inRound ? "round-row" : inUp ? "up-row" : "top";
      break;
    case "stopped":
      where = inStopped ? "stopped-row" : "top";
      break;
    case "stays":
      where = inRound ? "round-row" : "round";
      break;
    case "removed":
    case "removedTurn":
      where = page.round ? "round" : "top";
      break;
    case "count":
      where = page.queue.length > 0 ? "count" : "top";
      break;
  }
  return { where, qid, message, undo };
}

/** A confirmation set right where the change happened. */
function Confirmation({ inline, spacing = "mx-3 mb-3 mt-0" }: { inline: Inline; spacing?: string }) {
  const { group } = useLoopData();
  return (
    <NoticeFocus key={inline.message} spacing={spacing}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{inline.message}</span>
        {inline.undo ? (
          <SafeForm action={askThisRoundAction} className="inline-flex">
            <input type="hidden" name="groupId" value={group.id} />
            <input type="hidden" name="questionId" value={inline.undo} />
            <SubmitButton className="btn btn-quiet min-h-11 px-4 text-[14px]">{copy.questions.thisRound.undo}</SubmitButton>
          </SafeForm>
        ) : null}
      </span>
    </NoticeFocus>
  );
}

/** The element the page scrolls to for a confirmation. */
function targetFor(inline: Inline | null): string | null {
  if (!inline || inline.where === "top") return null;
  switch (inline.where) {
    case "round-row": return `round-q-${inline.qid}`;
    case "up-row": return `q-${inline.qid}`;
    case "stopped-row": return `stopped-q-${inline.qid}`;
    case "round": return "this-round";
    case "count": return "count-line";
  }
}

/**
 * The Questions page: the round, not the setup. Every question shows once. "This round" leads,
 * edited and put in order directly; "Not in this round" holds the rest, each a tap from joining it;
 * "Plan future rounds" folds the usual order and the turn-taking count away; Stopped sits last.
 * One card adds any kind of question.
 */
export default function QuestionsTab({ notices }: { notices: Notices }) {
  const { group, membership, questionsPage: page, suggestions } = useLoopData();
  const manages = membership.access !== "member";
  // Opening the add form asks it to scroll into view and take focus.
  const [addNow, setAddNow] = useState(0);
  // The owner is looking at this round, so "add it to this round too" starts ticked.
  const [thisRound, setThisRound] = useState(Boolean(page.round));
  // On a phone the add form stays folded until asked for; a problem with it brings it back open.
  const [addOpen, setAddOpen] = useState(
    notices.fromPacks !== undefined || (notices.problem !== undefined && notices.problem !== "count" && notices.problem !== "gone"),
  );
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
  const outside = everything.filter((item) => !inThisRound.has(item.id));
  const inline = manages ? placeNotice(notices, page, outside) : null;
  // Anything the page can't point at shows at the top, as before.
  const topMessage = inline === null || inline.where === "top" ? noticeMessage(notices) : null;

  return (
    <main className="loop-page mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6 lg:max-w-[1040px]">
      <LoopNav id={group.id} name={group.name} access={membership.access} active="Questions">
        <h1>{copy.questions.title}</h1>
        <p>{manages ? copy.questions.description : copy.questions.memberDescription}</p>
      </LoopNav>

      <PageNotices notices={notices} message={topMessage} />
      <ScrollToDone target={targetFor(inline)} />
      {group.pausedAt ? (
        <p className="notice mt-4 border bg-card px-4 py-3 text-[14px] font-bold leading-relaxed text-ink">
          {page.round ? copy.questions.pausedNote : copy.questions.pausedNoRound}
        </p>
      ) : null}

      <div className="questions-grid">
        <div className="questions-grid__main">
          {page.round || !manages ? <ThisRound everything={everything} manages={manages} inline={inline} /> : null}
          {manages ? (
            <>
              {page.round ? <NotInRound items={outside} inline={inline} /> : <YourQuestions items={outside} inline={inline} />}
              <Plan inThisRound={inThisRound} inline={inline} />
              {page.stopped.length > 0 ? <Stopped items={page.stopped} inline={inline} /> : null}
            </>
          ) : null}
        </div>
        {manages ? (
          <div className="questions-grid__side">
            <AddCard
              request={addNow}
              open={addOpen}
              onToggle={() => {
                if (!addOpen) setAddNow((count) => count + 1);
                setAddOpen(!addOpen);
              }}
              thisRound={thisRound}
              onThisRound={setThisRound}
              packsOpen={notices.fromPacks !== undefined}
            >
              {suggestions.length > 0 ? <Suggestions refObject={suggestionsRef} open={Boolean(notices.suggestion)} /> : null}
            </AddCard>
          </div>
        ) : null}
      </div>
    </main>
  );
}

function PageNotices({ notices, message }: { notices: Notices; message: string | null }) {
  const problem = notices.problem && notices.problem in copy.questions.errors ? copy.questions.errors[notices.problem as keyof typeof copy.questions.errors] : null;
  return (
    <>
      {message ? <Confirmation inline={{ where: "top", qid: null, message, undo: null }} spacing="mt-4" /> : null}
      {problem ? <NoticeFocus key={problem} tone="danger">{problem}</NoticeFocus> : null}
    </>
  );
}

/** "Next asked: Round 13, Fri 20 Nov": when it will next come up, and nothing else. */
function roundTag(round: { number: number; deliversAt: Date } | null, timezone: string): string {
  return round ? text(copy.questions.upNext.roundTag, { number: round.number, date: formatDate(round.deliversAt, timezone) }) : copy.questions.upNext.later;
}

/** One quiet line for a question that isn't in the round: when it comes back. */
function backTag(item: PageItem, openNumber: number | null): string {
  if (item.frequency === "on_date") {
    return item.nextLabel ? text(copy.questions.notInRound.onDate, { date: item.nextLabel }) : copy.questions.notInRound.passed;
  }
  if (item.firstRound) return text(copy.questions.notInRound.backInRound, { number: item.firstRound.number });
  if (item.frequency === "every_round" && openNumber !== null) return text(copy.questions.notInRound.backInRound, { number: openNumber + 1 });
  return copy.questions.notInRound.backLater;
}

function writtenNote(writers: string[]): string {
  return writers.length === 1
    ? text(copy.questions.thisRound.writtenOne, { name: writers[0] })
    : text(copy.questions.thisRound.writtenMany, { name: writers[0], count: writers.length - 1 });
}

/** The open round's items, in its order: reordered, removed and added to directly. */
function ThisRound({ everything, manages, inline }: { everything: PageItem[]; manages: boolean; inline: Inline | null }) {
  const { group, user, questionsPage: page, openMoment } = useLoopData();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const round = page.round;
  // One short form in the header; the overview's full wording (the viewer's time, the loop's in brackets) opens beneath it.
  // The same day everywhere: the overview's own phrase for the viewer's time, never a second date.
  const when = !round ? "" : openMoment ? atMoment(openMoment.primary) : formatDate(round.deliversAt, user.timezone || group.timezone);
  const fullWhen = !round
    ? ""
    : openMoment
      ? `${atMoment(openMoment.primary)}${openMoment.loop ? ` (${openMoment.loop})` : ""}`
      : atMoment(formatMoment(round.deliversAt, user.timezone || group.timezone));

  return (
    <section id="this-round" className="card mt-4 p-4 sm:p-5" aria-labelledby="this-round-title">
      <div className="section-head">
        <h2 id="this-round-title" className="text-ink">{copy.questions.thisRound.title}</h2>
        {round ? (
          <div className="min-w-0">
            <p className="m-0 text-[13.5px] font-bold text-ink-soft numeric">
              {round.name
                ? text(copy.questions.thisRound.metaNamed, { name: round.name, when })
                : text(copy.questions.thisRound.meta, { number: round.number, when })}
            </p>
            <details className="when-more">
              <summary className="link link--quiet inline-flex min-h-11 cursor-pointer items-center text-[13px]">{copy.questions.thisRound.whenMore}</summary>
              <p className="m-0 pb-1 text-[13.5px] leading-relaxed text-ink-soft numeric">{text(copy.loop.closes, { deadline: fullWhen })}</p>
            </details>
          </div>
        ) : null}
      </div>

      {inline?.where === "round" ? <Confirmation inline={inline} spacing="mt-3" /> : null}

      {!round ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{copy.questions.thisRound.noneMember}</p>
      ) : page.thisRound.length === 0 ? (
        <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">{copy.questions.thisRound.empty}</p>
      ) : (
        <div id="this-round-list" className="mt-3">
          <SortableList
            items={page.thisRound}
            label={copy.questions.thisRound.listLabel}
            nameOf={(row) => row.text}
            disabled={!manages}
            rowClassName="list-row"
            stepsInRow
            move={(id, index) => reorderRoundAction(group.id, id, index)}
          >
            {(row, index, steps) => {
              const item = row.questionId ? everything.find((candidate) => candidate.id === row.questionId) : undefined;
              const tags = itemTags(row);
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
                <div id={row.questionId ? `round-q-${row.questionId}` : undefined}>
                  <div className="row-line">
                    {manages && item ? (
                      <button
                        type="button"
                        className="item-row item-row--button"
                        aria-expanded={editing === row.id}
                        onClick={() => setEditing((current) => (current === row.id ? null : row.id))}
                      >
                        <span className="sr-only">{copy.questions.item.editPrefix} </span>
                        {content}
                      </button>
                    ) : (
                      <div className="item-row">{content}</div>
                    )}
                    {!manages ? null : row.writers.length > 0 ? (
                      <p className="row-reason">{writtenNote(row.writers)}</p>
                    ) : (
                      <button
                        type="button"
                        className="row-icon row-icon--danger"
                        aria-expanded={removing === row.id}
                        aria-controls={`remove-${row.id}`}
                        aria-label={text(copy.questions.thisRound.menu.openLabel, { item: row.text })}
                        title={copy.questions.thisRound.menu.open}
                        onClick={() => { setRemoving((current) => (current === row.id ? null : row.id)); }}
                      >
                        <IconTrash />
                      </button>
                    )}
                  </div>
                  {removing === row.id ? (
                    <div id={`remove-${row.id}`}>
                      <RemovePanel
                        groupId={group.id}
                        questionId={row.questionId}
                        snapshotId={row.id}
                        label={row.text}
                        turn={row.frequency === "rotating" && group.questionsPerRound !== null}
                        canSkip
                        onClose={() => setRemoving(null)}
                      />
                    </div>
                  ) : null}
                  {item && editing === row.id ? <ItemEditor item={item} groupId={group.id} inThisRound hideStop={row.writers.length === 0} steps={steps} /> : null}
                  {manages && !item ? <div className="item-editor">{steps}</div> : null}
                  {inline?.where === "round-row" && row.questionId === inline.qid && removing !== row.id ? <Confirmation inline={inline} /> : null}
                </div>
              );
            }}
          </SortableList>
        </div>
      )}

    </section>
  );
}

/** A row that isn't in the round: when it comes back, and a tap to add it. */
function OutsideRows({ items, inline, tagOf, label, canAdd }: { items: PageItem[]; inline: Inline | null; tagOf: (item: PageItem) => string | null; label: string; canAdd: boolean }) {
  const { group } = useLoopData();
  return (
    <ul className="plain-list mt-3" aria-label={label}>
      {items.map((item) => (
        <li key={item.id} className="list-row list-row--still">
          <ItemRow
            item={item}
            groupId={group.id}
            tag={tagOf(item)}
            inThisRound={false}
            manages
            poll={item.format === "poll" && item.pollOptions?.length ? <span className="poll-line block">{item.pollOptions.join(", ")}</span> : null}
            anchorId={`q-${item.id}`}
            action={canAdd && item.frequency !== "on_date" ? <AskNowButton item={item} groupId={group.id} /> : undefined}
            notice={inline?.where === "up-row" && inline.qid === item.id ? <Confirmation inline={inline} /> : null}
          />
        </li>
      ))}
    </ul>
  );
}

/** Questions that exist but aren't asked in the open round, each with when it comes back. */
function NotInRound({ items, inline }: { items: PageItem[]; inline: Inline | null }) {
  const { questionsPage: page } = useLoopData();
  if (items.length === 0) return null;
  const openNumber = page.round?.number ?? null;
  return (
    <section className="card mt-4 p-4 sm:p-5" aria-labelledby="not-in-round-title">
      <h2 id="not-in-round-title" className="text-ink">{copy.questions.notInRound.title}</h2>
      <OutsideRows canAdd items={items} inline={inline} label={copy.questions.notInRound.label} tagOf={(item) => backTag(item, openNumber)} />
    </section>
  );
}

/** With no round open there is nothing to be in or out of: one list of what the loop asks. */
function YourQuestions({ items, inline }: { items: PageItem[]; inline: Inline | null }) {
  const { group } = useLoopData();
  if (items.length === 0) return null;
  return (
    <section className="card mt-4 p-4 sm:p-5" aria-labelledby="your-questions-title">
      <h2 id="your-questions-title" className="text-ink">{copy.questions.upNext.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.thisRound.none}</p>
      <OutsideRows
        canAdd={false}
        items={items}
        inline={inline}
        label={copy.questions.upNext.title}
        tagOf={(item) => (item.frequency === "on_date" ? backTag(item, null) : item.frequency === "rotating" ? roundTag(item.firstRound, group.timezone) : null)}
      />
    </section>
  );
}

/** The usual order and how many turn-taking questions a round asks: folded away, for planning ahead. */
function Plan({ inThisRound, inline }: { inThisRound: Set<string>; inline: Inline | null }) {
  const { group, questionsPage: page } = useLoopData();
  const count = group.questionsPerRound;
  // A change made in here keeps it open, so the confirmation is seen where it happened.
  const showing = inline?.where === "count";
  const pollLine = (item: PageItem) => item.format === "poll" && item.pollOptions?.length
    ? <span className="poll-line block">{item.pollOptions.join(", ")}</span>
    : null;

  const next = page.plan[0];
  const labels = new Map([...page.queue, ...page.everyRound, ...page.dated].map((item) => [item.id, item.label]));
  const nextIds = next ? [...page.everyRound.map((item) => item.id), ...next.turns, ...next.dated.map((item) => item.id)] : [];
  const nextTitles = nextIds.flatMap((id) => (labels.has(id) ? [labels.get(id)!] : []));
  const shown = nextTitles.slice(0, 3).join(", ");
  const more = nextTitles.length - 3;
  const nextLine = nextTitles.length === 0
    ? copy.questions.plan.nextNone
    : nextTitles.length === 1
      ? copy.questions.plan.nextOne
      : text(copy.questions.plan.nextMany, { count: nextTitles.length });

  return (
    <details className="card mt-4 p-4 sm:p-5" open={showing || undefined}>
      <summary className="up-summary">
        <h2 id="plan-title" className="text-ink">{copy.questions.plan.summary}</h2>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>

      <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">{copy.questions.plan.intro}</p>
      <p className="mt-2 text-[14px] font-bold leading-relaxed text-ink">{nextLine}</p>
      {nextTitles.length > 0 ? (
        <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-muted">
          {more > 0 ? text(copy.questions.plan.andMore, { titles: shown, count: more }) : text(copy.questions.plan.nextTitles, { titles: shown })}
        </p>
      ) : null}

      <h3 className="group-label">{copy.questions.upNext.turnsTitle}</h3>
      {page.queue.length > 0 ? (
        <SafeForm id="count-line" action={rotationAction} className="count-line">
          <input type="hidden" name="groupId" value={group.id} />
          <span>{copy.questions.upNext.countBefore}</span>
          <AutoPicker name="questionsPerRound" defaultValue={count?.toString() ?? ""} options={COUNT_OPTIONS} ariaLabel={copy.questions.upNext.countLabel} />
          {copy.questions.upNext.countAfter ? <span>{copy.questions.upNext.countAfter}</span> : null}
        </SafeForm>
      ) : null}
      {inline?.where === "count" ? <Confirmation inline={inline} spacing="mt-2" /> : null}
      {page.queue.length > 0 ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{count === null ? copy.questions.upNext.turnsAllHelp : copy.questions.upNext.turnsHelp}</p>
          <div className="mt-2">
            <SortableList
              items={page.queue}
              label={copy.questions.upNext.turnsLabel}
              nameOf={(item) => item.label}
              rowClassName="list-row"
              move={(id, index) => reorderListAction(group.id, "rotating", id, index)}
            >
              {(item, index) => (
                <ItemRow item={item} groupId={group.id} number={index + 1} tag={roundTag(item.firstRound, group.timezone)} inThisRound={inThisRound.has(item.id)} manages poll={pollLine(item)} anchorId={`plan-q-${item.id}`} />
              )}
            </SortableList>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.turnsEmpty}</p>
      )}

      <h3 className="group-label">{copy.questions.upNext.everyRoundTitle}</h3>
      {page.everyRound.length > 0 ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-muted">{copy.questions.upNext.everyRoundHelp}</p>
          <div className="mt-2">
            <SortableList
              items={page.everyRound}
              label={copy.questions.upNext.everyRoundLabel}
              nameOf={(item) => item.label}
              rowClassName="list-row"
              move={(id, index) => reorderListAction(group.id, "every_round", id, index)}
            >
              {(item) => <ItemRow item={item} groupId={group.id} inThisRound={inThisRound.has(item.id)} manages poll={pollLine(item)} anchorId={`plan-q-${item.id}`} />}
            </SortableList>
          </div>
        </>
      ) : (
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.everyRoundEmpty}</p>
      )}

      <h3 className="group-label">{copy.questions.upNext.datedTitle}</h3>
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
                    item.firstRound ? text(copy.questions.upNext.askedIn, { number: item.firstRound.number }) : null,
                  ].filter(Boolean).join(" · ")}
                  inThisRound={inThisRound.has(item.id)}
                  manages
                  anchorId={`plan-q-${item.id}`}
                />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{copy.questions.upNext.datedEmpty}</p>
      )}
    </details>
  );
}

/** One card for any kind of item, with the question packs folded beneath. */
function AddCard({ request, open, onToggle, thisRound, onThisRound, packsOpen, children }: { children?: React.ReactNode; request: number; open: boolean; onToggle: () => void; thisRound: boolean; onThisRound: (value: boolean) => void; packsOpen: boolean }) {
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
    <div className="add-wrap">
    {/* A phone opens the form from here, right under the header; a desktop keeps it in view beside the list. */}
    <button type="button" className="btn btn-primary add-toggle items-center justify-center" aria-expanded={open} aria-controls="add-item" onClick={onToggle}>
      <span aria-hidden="true" className="mr-1.5">+</span>{copy.questions.add.open}
    </button>
    <section id="add-item" className={`card mt-4 p-4 sm:p-5${open ? "" : " add-closed"}`} aria-labelledby="add-item-title">
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
    {children}
    </div>
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
function Stopped({ items, inline }: { items: PageItem[]; inline: Inline | null }) {
  const { group } = useLoopData();
  return (
    <details className="card plain-details after-2 mt-4 px-4 py-1.5" open={inline?.where === "stopped-row" || undefined}>
      <summary className="pool-summary min-h-11 cursor-pointer">
        <span className="text-[15px] font-extrabold text-ink numeric">{text(copy.questions.item.stoppedTitle, { count: items.length })}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true" className="item-chevron">
          <path d="M5 7.5 10 12.5 15 7.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <ul className="plain-list mb-3 mt-2" aria-label={copy.questions.item.stoppedLabel}>
        {items.map((item) => (
          <li key={item.id} id={`stopped-q-${item.id}`} className="list-row list-row--still">
            <div className="row-line">
              <div className="item-row">
                <span className="item-main">
                  <ItemLabel emoji={item.emoji} label={item.label} />
                  <span className="item-meta">{itemTags(item)}</span>
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
            {inline?.where === "stopped-row" && inline.qid === item.id ? <Confirmation inline={inline} /> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

"use client";

import { SafeForm } from "@/components/safe-form";
import { useEffect, useRef, useState } from "react";
import {
  acceptSuggestionAction,
  addAction,
  addFromPacksAction,
  addPollAction,
  archiveSectionAction,
  createSectionAction,
  declineSuggestionAction,
  moveSectionAction,
  rotationAction,
  updateSectionAction,
} from "./actions";
import { QuestionOrder } from "./question-order";
import { ConfirmAction } from "@/components/confirm-action";
import { FieldLabel } from "@/components/field-label";
import { NoticeFocus } from "@/components/notice-focus";
import { LoopNav } from "@/components/loop-nav";
import { Picker } from "@/components/picker";
import { AutoPicker } from "@/components/auto-picker";
import { QuestionPackPicker } from "@/components/question-pack-picker";
import { QUESTION_PACKS, newQuestionTexts } from "@/lib/question-packs";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, POLL_PROMPT_MAX } from "@/lib/poll";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";
import { PollSummary } from "./poll-summary";
import { EventsPanel } from "./events-panel";
import { SubmitButton } from "@/components/submit-button";

const ROTATION_OPTIONS = [
  { value: "", label: copy.questions.allQuestions },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
];

type View = "pool" | "add" | "extras";

export default function QuestionsTab({ notices }: { notices: { added?: string; archived?: string; skip?: string; rotation?: string; fromPacks?: string; suggestion?: string; section?: string; poll?: string; event?: string } }) {
  const { group, membership, questions: pool, suggestions, sections } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";
  const [picked, setPicked] = useState<string[]>([]);
  // A form on the other parts of the page comes back here with a notice: stay where that form lives.
  const [view, setView] = useState<View>(() =>
    notices.section || notices.event ? "extras" : notices.fromPacks || notices.poll ? "add" : "pool",
  );
  const poolTexts = pool.map((question) => question.text);

  const toggleQuestion = (question: string) => {
    setPicked((current) => current.includes(question)
      ? current.filter((item) => item !== question)
      : [...current, question]);
  };
  const togglePack = (questions: string[], select: boolean) => {
    setPicked((current) => select
      ? [...current, ...questions.filter((question) => !current.includes(question))]
      : current.filter((question) => !questions.includes(question)));
  };
  // Picks the pool already has (say, just added) never count or travel with the form.
  const fresh = newQuestionTexts(picked, poolTexts);

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <LoopNav id={id} name={group.name} access={membership.access} active="Questions">
        <h1>{copy.questions.title}</h1>
        <p>{copy.questions.description}</p>
        {manages ? (
          <div className="subtabs" role="group" aria-label={copy.questions.viewsLabel}>
            {([["pool", copy.questions.viewPool], ["add", copy.questions.viewAdd], ["extras", copy.questions.viewExtras]] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className="subtab">{label}</button>
            ))}
          </div>
        ) : null}
      </LoopNav>

      {notices.added ? <NoticeFocus>{copy.questions.addedNotice}</NoticeFocus> : null}
      {notices.archived ? <NoticeFocus key={notices.archived}>{copy.questions.archivedNotice}</NoticeFocus> : null}
      {notices.skip ? <NoticeFocus key={notices.skip}>{copy.questions.skipSavedNotice}</NoticeFocus> : null}
      {notices.suggestion === "added" ? <NoticeFocus>{copy.questions.suggestionAddedNotice}</NoticeFocus> : null}
      {notices.suggestion === "declined" ? <NoticeFocus>{copy.questions.suggestionDeclinedNotice}</NoticeFocus> : null}
      {notices.suggestion === "gone" ? <NoticeFocus>{copy.questions.suggestionGoneNotice}</NoticeFocus> : null}
      {notices.poll === "added" ? <NoticeFocus>{copy.polls.authoring.addedNotice}</NoticeFocus> : null}
      {notices.poll === "invalid" ? <NoticeFocus tone="danger">{copy.polls.authoring.invalidNotice}</NoticeFocus> : null}
      {notices.section === "created" ? <NoticeFocus>{copy.questions.sectionCreatedNotice}</NoticeFocus> : null}
      {notices.section === "saved" ? <NoticeFocus>{copy.questions.sectionSavedNotice}</NoticeFocus> : null}
      {notices.section === "archived" ? <NoticeFocus>{copy.questions.sectionArchivedNotice}</NoticeFocus> : null}
      {notices.section === "moved" ? <NoticeFocus>{copy.questions.sectionMovedNotice}</NoticeFocus> : null}
      {notices.section === "invalid" ? <NoticeFocus tone="danger">{copy.reply.errors.sectionSaveFailed}</NoticeFocus> : null}
      {notices.event === "added" ? <NoticeFocus>{copy.events.addedNotice}</NoticeFocus> : null}
      {notices.event === "saved" ? <NoticeFocus>{copy.events.savedNotice}</NoticeFocus> : null}
      {notices.event === "removed" ? <NoticeFocus>{copy.events.removedNotice}</NoticeFocus> : null}
      {notices.event && notices.event in copy.events.errors ? (
        <NoticeFocus tone="danger">{copy.events.errors[notices.event as keyof typeof copy.events.errors]}</NoticeFocus>
      ) : null}
      {notices.rotation === "1" ? <NoticeFocus>{copy.questions.rotationSaved}</NoticeFocus> : null}
      {notices.rotation === "invalid" ? <NoticeFocus tone="danger">{copy.questions.rotationInvalid}</NoticeFocus> : null}
      {notices.fromPacks === "0" ? <NoticeFocus>{copy.questions.fromPacksNone}</NoticeFocus> : null}
      {notices.fromPacks && notices.fromPacks !== "0" ? (
        <NoticeFocus>
          {Number(notices.fromPacks) === 1
            ? copy.questions.fromPacksAddedOne
            : text(copy.questions.fromPacksAdded, { count: notices.fromPacks })}
        </NoticeFocus>
      ) : null}

      <div hidden={manages && view !== "pool"}>
      {manages ? (
        <div className="card mt-4 px-4 py-1.5">
          <details className="plain-details">
            <summary className="pool-summary min-h-11 cursor-pointer">
              <span className="text-[15px] font-bold text-ink-soft numeric">
                {group.questionsPerRound
                  ? text(copy.questions.poolSummarySome, { per: group.questionsPerRound, count: pool.length })
                  : text(copy.questions.poolSummaryAll, { count: pool.length })}
              </span>
              <span className="link">{copy.questions.poolChangeCount}</span>
            </summary>
            <SafeForm action={rotationAction} className="pb-3">
              <input type="hidden" name="groupId" value={id} />
              <p className="m-0 mb-2 text-[14px] leading-relaxed text-ink-soft">{copy.questions.rotationDescription}</p>
              <AutoPicker
                name="questionsPerRound"
                defaultValue={group.questionsPerRound?.toString() ?? ""}
                options={ROTATION_OPTIONS}
                ariaLabel={copy.questions.rotationTitle}
              />
            </SafeForm>
          </details>
        </div>
      ) : null}

      {manages && suggestions.length > 0 ? (
        <details className="card plain-details mt-4 px-4 py-1.5" aria-label={copy.questions.suggestionsTitle} open={notices.suggestion ? true : undefined}>
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
                  {text(copy.questions.suggestionAuthor, {
                    name: suggestion.authorName ?? suggestion.authorEmail.split("@")[0],
                  })}
                  {suggestion.authorDisplay === "anonymous" ? (
                    <span className="ml-2 chip border bg-card px-2 py-0.5 text-[11px] text-ink-soft">
                      {copy.questions.suggestionAnonymous}
                    </span>
                  ) : null}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <SafeForm action={acceptSuggestionAction} className="contents">
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="suggestionId" value={suggestion.id} />
                    <label className="flex basis-full flex-col gap-1.5">
                      <FieldLabel required>{copy.questions.suggestionTextLabel}</FieldLabel>
                      <textarea name="text" required rows={2} maxLength={200} defaultValue={suggestion.text} className="field min-h-[72px]" />
                    </label>
                    <SubmitButton className="btn btn-primary min-h-11 px-4 text-[14px]">{copy.questions.suggestionSave}</SubmitButton>
                  </SafeForm>
                  <SafeForm action={declineSuggestionAction} className="contents">
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="suggestionId" value={suggestion.id} />
                    <SubmitButton className="btn btn-quiet min-h-11 px-4 text-[14px]">{copy.questions.suggestionDecline}</SubmitButton>
                  </SafeForm>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

            {manages && pool.length ? <QuestionOrder groupId={id} questions={pool.map(({ id: questionId, text, skipNext, kind, pollMultiple, pollOptions }) => ({ id: questionId, text, skipNext, kind, pollMultiple, pollOptions }))} /> : (
        <ol className="mt-5 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
          {pool.map((question, index) => <li key={question.id} className="card paper p-4"><div className="flex items-start gap-3"><span className="question-number">{index + 1}</span><div><p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p><PollSummary question={question} />{question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}</div></div></li>)}
          {pool.length === 0 ? <li className="card p-5 text-[14px] text-ink-muted"><p>{copy.questions.empty}</p>{manages ? <a href="#question-form" className="btn btn-primary mt-4 inline-flex">{copy.questions.firstQuestionAction}</a> : null}</li> : null}
        </ol>
      )}

      {manages ? (
        <SafeForm action={addAction} id="question-form" className="card mt-4 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-ink">{copy.questions.addTitle}</h2>
          <label className="mt-3 flex flex-col gap-1.5">
            <FieldLabel required>{copy.questions.newQuestionAriaLabel}</FieldLabel>
            <input
              name="text"
              required
              maxLength={200}
              placeholder={copy.questions.newQuestionPlaceholder}
              className="field h-[46px] py-0"
            />
          </label>
          <SubmitButton className="btn btn-primary mt-3">
            {copy.questions.add}
          </SubmitButton>
        </SafeForm>
      ) : null}

      </div>

      {manages ? <div hidden={view !== "add"}>
      <PollForm groupId={id} />

      <SafeForm action={addFromPacksAction} className="card mt-4 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-ink">{copy.questions.packsTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.packsDescription}</p>
          <div className="pack-addbar" data-active={fresh.length > 0 ? "" : undefined}>
            <span className="text-[14px] font-bold text-ink-soft numeric">
              {text(copy.common.selectedCount, { count: fresh.length })}
            </span>
            {/* aria-disabled, not disabled: the button stays reachable and says why nothing happens yet. */}
            <SubmitButton
              blocked={fresh.length === 0}
              className="btn btn-primary min-h-11 px-5 text-[14px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
            >
              {copy.questions.addToPool}
            </SubmitButton>
          </div>
          <QuestionPackPicker
            packs={QUESTION_PACKS}
            selected={picked}
            inPool={poolTexts}
            onToggleQuestion={toggleQuestion}
            onTogglePack={togglePack}
            ariaLabel={copy.questions.packsTitle}
          />
          {fresh.map((question) => (
            <input key={question} type="hidden" name="question" value={question} />
          ))}
        </SafeForm>
      </div> : null}

      {manages ? <div hidden={view !== "extras"}>
      <section className="card mt-4 p-5" aria-label={copy.questions.sectionsTitle}>
          <h2 className="text-ink">{copy.questions.sectionsTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.sectionsDescription}</p>

          {sections.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-2.5" aria-label={copy.questions.sectionListLabel}>
              {sections.map((section, index) => (
                <li key={section.id} className="card border p-4">
                  <div className="row row--wrap">
                    <div className="min-w-0 flex-1">
                      <p className="m-0 text-[15px] font-bold leading-snug text-ink">
                        {section.emoji ? <span className="mr-2">{section.emoji}</span> : null}
                        {section.title}
                        {!section.active ? <span className="ml-2 text-[13px] font-medium text-ink-muted">({copy.questions.sectionActive}: off)</span> : null}
                      </p>
                      <p className="m-0 mt-0.5 text-[13px] font-medium text-ink-muted">
                        {section.kind === "photo_wall" ? copy.questions.sectionKindPhotoWall : section.kind === "music" ? copy.questions.sectionKindMusic : copy.questions.sectionKindStandard}
                        {section.adminOnly ? ` · ${copy.questions.sectionAdminOnly}` : ""}
                      </p>
                      {section.description ? <p className="m-0 mt-1 text-[14px] leading-relaxed text-ink-soft">{section.description}</p> : null}
                    </div>
                    <details className="row-more">
                      <summary aria-label={text(copy.questions.moreLabel, { question: section.title })} title={copy.questions.more}>
                        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-5 w-5" fill="currentColor"><circle cx="4" cy="10" r="1.8" /><circle cx="10" cy="10" r="1.8" /><circle cx="16" cy="10" r="1.8" /></svg>
                      </summary>
                      <div className="row-more__body">
                        <SafeForm action={moveSectionAction}>
                          <input type="hidden" name="groupId" value={id} />
                          <input type="hidden" name="sectionId" value={section.id} />
                          <input type="hidden" name="targetIndex" value={index - 1} />
                          <SubmitButton aria-label={text(copy.a11yLabels.moveSectionUp, { title: section.title })} disabled={index === 0} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionUp}</SubmitButton>
                        </SafeForm>
                        <SafeForm action={moveSectionAction}>
                          <input type="hidden" name="groupId" value={id} />
                          <input type="hidden" name="sectionId" value={section.id} />
                          <input type="hidden" name="targetIndex" value={index + 1} />
                          <SubmitButton aria-label={text(copy.a11yLabels.moveSectionDown, { title: section.title })} disabled={index === sections.length - 1} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionDown}</SubmitButton>
                        </SafeForm>
                        <ConfirmAction
                          tone="quiet"
                          action={archiveSectionAction}
                          fields={{ groupId: id, sectionId: section.id }}
                          label={copy.questions.sectionArchive}
                          triggerLabel={text(copy.a11yLabels.archiveSection, { title: section.title })}
                          question={text(copy.a11yLabels.archiveSectionQuestion, { title: section.title })}
                          body={copy.a11yLabels.archiveSectionBody}
                          confirmLabel={text(copy.a11yLabels.archiveSectionConfirm, { title: section.title })}
                          cancelLabel={copy.a11yLabels.confirmCancel}
                        />
                        <details className="plain-details basis-full">
                          <summary aria-label={text(copy.a11yLabels.editSection, { title: section.title })} className="link link--quiet cursor-pointer">{copy.questions.sectionEdit}</summary>
                          <SafeForm action={updateSectionAction} className="mt-2 flex flex-col gap-2">
                            <input type="hidden" name="groupId" value={id} />
                            <input type="hidden" name="sectionId" value={section.id} />
                            <label className="flex flex-col gap-1.5">
                              <FieldLabel required>{copy.questions.sectionTitleLabel}</FieldLabel>
                              <input name="title" defaultValue={section.title} maxLength={80} required className="field h-[46px] py-0" />
                            </label>
                            <label className="flex flex-col gap-1.5">
                              <FieldLabel>{copy.questions.sectionEmojiLabel}</FieldLabel>
                              <input name="emoji" defaultValue={section.emoji ?? ""} maxLength={8} className="field h-[46px] py-0" />
                            </label>
                            <label className="flex flex-col gap-1.5">
                              <FieldLabel>{copy.questions.sectionDescriptionLabel}</FieldLabel>
                              <input name="description" defaultValue={section.description ?? ""} maxLength={200} placeholder={copy.questions.sectionDescriptionPlaceholder} className="field h-[46px] py-0" />
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-[14px] text-ink">
                              <input type="checkbox" name="adminOnly" defaultChecked={section.adminOnly} className="accent-accent" /> {copy.questions.sectionAdminOnly}
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-[14px] text-ink">
                              <input type="checkbox" name="active" defaultChecked={section.active} className="accent-accent" /> {copy.questions.sectionActive}
                            </label>
                            <div>
                              <SubmitButton className="btn btn-primary min-h-11 px-4 text-[14px]">{copy.questions.sectionSaveEdit}</SubmitButton>
                            </div>
                          </SafeForm>
                        </details>
                      </div>
                    </details>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[14px] text-ink-muted">{copy.questions.sectionsEmpty}</p>
          )}

          <SafeForm action={createSectionAction} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="groupId" value={id} />
            <h3 className="subhead">{copy.questions.sectionAddTitle}</h3>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_4.5rem] gap-2 sm:grid-cols-[minmax(0,1fr)_5rem]">
              <div>
                <label htmlFor="section-title" className="block text-[13px] font-bold text-ink-soft">{copy.questions.sectionTitleLabel} {copy.a11yLabels.required}</label>
                <input id="section-title" name="title" required maxLength={80} placeholder={copy.questions.sectionTitlePlaceholder} className="field mt-1 h-[46px] py-0" />
              </div>
              <div>
                <label htmlFor="section-emoji" className="block text-[13px] font-bold text-ink-soft">{copy.questions.sectionEmojiLabel}</label>
                <input id="section-emoji" name="emoji" maxLength={8} placeholder={copy.questions.sectionEmojiPlaceholder} className="field emoji-field mt-1 h-[46px] py-0 text-center" />
              </div>
            </div>
            <span className="mt-3 block text-[13px] font-bold text-ink-soft">{copy.questions.sectionKindLabel}</span>
            <div className="mt-1">
              <Picker
                name="kind"
                defaultValue="standard"
                ariaLabel={copy.questions.sectionKindLabel}
                options={[
                  { value: "standard", label: copy.questions.sectionKindStandard },
                  { value: "photo_wall", label: copy.questions.sectionKindPhotoWall },
                  { value: "music", label: copy.questions.sectionKindMusic },
                ]}
              />
            </div>
            <label htmlFor="section-description" className="mt-3 block text-[13px] font-bold text-ink-soft">{copy.questions.sectionDescriptionLabel}</label>
            <input id="section-description" name="description" maxLength={200} placeholder={copy.questions.sectionDescriptionPlaceholder} className="field mt-1 h-[46px] py-0" />
            <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="adminOnly" className="accent-accent" /> {copy.questions.sectionAdminOnly}
            </label>
            <SubmitButton className="btn btn-primary mt-3">{copy.questions.sectionCreate}</SubmitButton>
          </SafeForm>
      </section>

      <EventsPanel />
      </div> : null}
    </main>
  );
}

/** A poll starts with the two options it needs; more appear one at a time, up to six. */
function PollForm({ groupId }: { groupId: string }) {
  const [options, setOptions] = useState(2);
  const added = useRef(false);
  const list = useRef<HTMLDivElement>(null);

  // The new field takes focus, so the keyboard carries on typing where the option appeared.
  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    list.current?.querySelectorAll("input")[options - 1]?.focus();
  }, [options]);

  return (
    <SafeForm action={addPollAction} id="poll-form" className="card mt-4 p-5">
      <input type="hidden" name="groupId" value={groupId} />
      <h2 className="text-ink">{copy.polls.authoring.title}</h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.polls.authoring.description}</p>
      <label htmlFor="poll-prompt" className="mt-3 block text-[13px] font-bold text-ink-soft">{copy.polls.authoring.promptLabel} {copy.a11yLabels.required}</label>
      <input
        id="poll-prompt"
        name="prompt"
        required
        maxLength={POLL_PROMPT_MAX}
        placeholder={copy.polls.authoring.promptPlaceholder}
        className="field mt-1 h-[46px] py-0"
      />
      <div ref={list} className="mt-3 flex flex-col gap-2">
        {Array.from({ length: options }, (_, index) => (
          <label key={index} className="flex flex-col gap-1.5">
            <FieldLabel required={index < 2}>{text(copy.polls.authoring.optionLabel, { number: index + 1 })}</FieldLabel>
            <input
              name="option"
              required={index < 2}
              maxLength={POLL_OPTION_MAX}
              placeholder={copy.polls.authoring.optionPlaceholder}
              className="field h-[46px] py-0"
            />
          </label>
        ))}
      </div>
      {options < POLL_MAX_OPTIONS ? (
        <button
          type="button"
          onClick={() => { added.current = true; setOptions((count) => Math.min(count + 1, POLL_MAX_OPTIONS)); }}
          className="btn btn-quiet mt-2 min-h-11 px-4 text-[13px]"
        >
          {copy.polls.authoring.addOption}
        </button>
      ) : null}
      <label className="mt-3 flex min-h-11 items-center gap-2 text-[14px] text-ink">
        <input type="checkbox" name="multiple" className="h-5 w-5 accent-accent" /> {copy.polls.authoring.multipleLabel}
      </label>
      <div>
        <SubmitButton className="btn btn-primary mt-3">{copy.polls.authoring.add}</SubmitButton>
      </div>
    </SafeForm>
  );
}

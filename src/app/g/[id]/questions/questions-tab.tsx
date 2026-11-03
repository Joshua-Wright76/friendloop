"use client";

import Link from "next/link";
import { useState } from "react";
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
import { QuestionPackPicker } from "@/components/question-pack-picker";
import { QUESTION_PACKS, newQuestionTexts } from "@/lib/question-packs";
import { POLL_MAX_OPTIONS, POLL_OPTION_MAX, POLL_PROMPT_MAX } from "@/lib/poll";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";
import { PollSummary } from "./poll-summary";
import { EventsPanel } from "./events-panel";

const ROTATION_OPTIONS = [
  { value: "", label: copy.questions.allQuestions },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
];

export default function QuestionsTab({ notices }: { notices: { added?: string; archived?: string; rotation?: string; fromPacks?: string; suggestion?: string; section?: string; poll?: string; event?: string } }) {
  const { group, membership, questions: pool, suggestions, sections } = useLoopData();
  const id = group.id;
  const manages = membership.access !== "member";
  const [picked, setPicked] = useState<string[]>([]);
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
  const addable = newQuestionTexts(picked, poolTexts).length;

  return (
    <main className="mx-auto w-full max-w-[680px] px-4 pb-16 pt-5 sm:px-6">
      <header className="mb-5">
        <Link href={`/g/${id}`} className="text-[13px] font-medium text-ink-soft hover:text-ink">
          {copy.common.backToLoop}
        </Link>
      </header>
      <LoopNav id={id} active="Questions" isOwner={membership.access === "owner"} />

      <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.025em] text-ink">{copy.questions.title}</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
        {copy.questions.description}
      </p>

      {notices.added ? <NoticeFocus>{copy.questions.addedNotice}</NoticeFocus> : null}
      {notices.archived ? <NoticeFocus>{copy.questions.archivedNotice}</NoticeFocus> : null}
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

      {manages && suggestions.length > 0 ? (
        <section className="card mt-5 border-accent-line bg-accent-soft p-5" aria-label={copy.questions.suggestionsTitle}>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.suggestionsTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.suggestionsDescription}</p>
          <ul className="mt-4 flex flex-col gap-3">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="card p-4">
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
                <form action={acceptSuggestionAction} className="mt-2">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="suggestionId" value={suggestion.id} />
                  <label className="flex flex-col gap-1.5">
                    <FieldLabel required>{copy.questions.suggestionTextLabel}</FieldLabel>
                    <input
                      name="text"
                      required
                      maxLength={200}
                      defaultValue={suggestion.text}
                      className="field h-[46px] py-0"
                    />
                  </label>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button type="submit" className="btn btn-primary min-h-11 px-4 text-[13px]">
                      {copy.questions.suggestionSave}
                    </button>
                  </div>
                </form>
                <form action={declineSuggestionAction} className="mt-2">
                  <input type="hidden" name="groupId" value={id} />
                  <input type="hidden" name="suggestionId" value={suggestion.id} />
                  <button type="submit" className="btn btn-quiet min-h-11 px-4 text-[13px]">
                    {copy.questions.suggestionDecline}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {manages ? (
        <form action={rotationAction} className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.rotationTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.rotationDescription}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="min-w-44 flex-1">
              <Picker
                name="questionsPerRound"
                defaultValue={group.questionsPerRound?.toString() ?? ""}
                options={ROTATION_OPTIONS}
                ariaLabel={copy.questions.rotationTitle}
              />
            </div>
            <button type="submit" className="btn btn-quiet">{copy.questions.saveRotation}</button>
          </div>
        </form>
      ) : null}

      {manages && pool.length ? <QuestionOrder groupId={id} questions={pool.map(({ id: questionId, text, skipNext, kind, pollMultiple, pollOptions }) => ({ id: questionId, text, skipNext, kind, pollMultiple, pollOptions }))} /> : (
        <ol className="mt-5 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
          {pool.map((question, index) => <li key={question.id} className="card paper p-4"><div className="flex items-start gap-3"><span className="question-number">{index + 1}</span><div><p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p><PollSummary question={question} />{question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}</div></div></li>)}
          {pool.length === 0 ? <li className="card p-5 text-[14px] text-ink-muted"><p>{copy.questions.empty}</p>{manages ? <a href="#question-form" className="btn btn-primary mt-4 inline-flex">{copy.questions.firstQuestionAction}</a> : null}</li> : null}
        </ol>
      )}

      {manages ? (
        <form action={addAction} id="question-form" className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.addTitle}</h2>
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
          <button type="submit" className="btn btn-primary mt-3">
            {copy.questions.add}
          </button>
        </form>
      ) : null}

      {manages ? (
        <form action={addPollAction} id="poll-form" className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.polls.authoring.title}</h2>
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
          <div className="mt-3 flex flex-col gap-2">
            {Array.from({ length: POLL_MAX_OPTIONS }, (_, index) => (
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
          <label className="mt-3 flex min-h-11 items-center gap-2 text-[14px] text-ink">
            <input type="checkbox" name="multiple" className="h-5 w-5 accent-accent" /> {copy.polls.authoring.multipleLabel}
          </label>
          <button type="submit" className="btn btn-primary mt-3">{copy.polls.authoring.add}</button>
        </form>
      ) : null}

      {manages ? (
        <section className="card mt-5 p-5" aria-label={copy.questions.sectionsTitle}>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.sectionsTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.sectionsDescription}</p>

          {sections.length > 0 ? (
            <ol className="mt-4 flex flex-col gap-2.5" aria-label={copy.questions.sectionListLabel}>
              {sections.map((section, index) => (
                <li key={section.id} className="card border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[15px] font-medium leading-snug text-ink">
                      {section.emoji ? <span className="mr-2">{section.emoji}</span> : null}
                      {section.title}
                      {!section.active ? <span className="ml-2 text-[12px] font-medium text-ink-muted">({copy.questions.sectionActive}: off)</span> : null}
                    </p>
                    <div className="flex flex-none gap-1">
                      <form action={moveSectionAction}>
                        <input type="hidden" name="groupId" value={id} />
                        <input type="hidden" name="sectionId" value={section.id} />
                        <input type="hidden" name="targetIndex" value={index - 1} />
                        <button type="submit" aria-label={text(copy.a11yLabels.moveSectionUp, { title: section.title })} disabled={index === 0} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionUp}</button>
                      </form>
                      <form action={moveSectionAction}>
                        <input type="hidden" name="groupId" value={id} />
                        <input type="hidden" name="sectionId" value={section.id} />
                        <input type="hidden" name="targetIndex" value={index + 1} />
                        <button type="submit" aria-label={text(copy.a11yLabels.moveSectionDown, { title: section.title })} disabled={index === sections.length - 1} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionDown}</button>
                      </form>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[12px] font-medium text-ink-muted">
                    {section.kind === "photo_wall" ? copy.questions.sectionKindPhotoWall : section.kind === "music" ? copy.questions.sectionKindMusic : copy.questions.sectionKindStandard}
                    {section.adminOnly ? ` · ${copy.questions.sectionAdminOnly}` : ""}
                  </p>
                  {section.description ? <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{section.description}</p> : null}
                  <details className="mt-2">
                    <summary aria-label={text(copy.a11yLabels.editSection, { title: section.title })} className="min-h-11 cursor-pointer text-[13px] font-bold text-ink leading-[44px]">{copy.questions.sectionEdit}</summary>
                    <form action={updateSectionAction} className="mt-2 flex flex-col gap-2">
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
                      <label className="flex items-center gap-2 text-[13px] text-ink">
                        <input type="checkbox" name="adminOnly" defaultChecked={section.adminOnly} className="accent-accent" /> {copy.questions.sectionAdminOnly}
                      </label>
                      <label className="flex items-center gap-2 text-[13px] text-ink">
                        <input type="checkbox" name="active" defaultChecked={section.active} className="accent-accent" /> {copy.questions.sectionActive}
                      </label>
                      <div className="flex gap-2">
                        <button type="submit" className="btn btn-primary min-h-11 px-4 text-[13px]">{copy.questions.sectionSaveEdit}</button>
                      </div>
                    </form>
                  </details>
                  <ConfirmAction
                    className="mt-2"
                    action={archiveSectionAction}
                    fields={{ groupId: id, sectionId: section.id }}
                    label={copy.questions.sectionArchive}
                    triggerLabel={text(copy.a11yLabels.archiveSection, { title: section.title })}
                    question={text(copy.a11yLabels.archiveSectionQuestion, { title: section.title })}
                    body={copy.a11yLabels.archiveSectionBody}
                    confirmLabel={text(copy.a11yLabels.archiveSectionConfirm, { title: section.title })}
                    cancelLabel={copy.a11yLabels.confirmCancel}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-[14px] text-ink-muted">{copy.questions.sectionsEmpty}</p>
          )}

          <form action={createSectionAction} className="mt-4 border-t border-line pt-4">
            <input type="hidden" name="groupId" value={id} />
            <h3 className="text-[14px] font-semibold text-ink">{copy.questions.sectionAddTitle}</h3>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_5rem]">
              <label className="flex flex-col gap-1.5">
                <FieldLabel required>{copy.questions.sectionTitleLabel}</FieldLabel>
                <input name="title" required maxLength={80} placeholder={copy.questions.sectionTitlePlaceholder} className="field h-[46px] py-0" />
              </label>
              <label className="flex flex-col gap-1.5">
                <FieldLabel>{copy.questions.sectionEmojiLabel}</FieldLabel>
                <input name="emoji" maxLength={8} className="field h-[46px] py-0" />
              </label>
            </div>
            <label className="mt-2 flex flex-col gap-1.5">
              <FieldLabel>{copy.questions.sectionKindLabel}</FieldLabel>
              <select name="kind" className="field h-[46px] py-0" defaultValue="standard">
                <option value="standard">{copy.questions.sectionKindStandard}</option>
                <option value="photo_wall">{copy.questions.sectionKindPhotoWall}</option>
                <option value="music">{copy.questions.sectionKindMusic}</option>
              </select>
            </label>
            <label className="mt-2 flex flex-col gap-1.5">
              <FieldLabel>{copy.questions.sectionDescriptionLabel}</FieldLabel>
              <input name="description" maxLength={200} placeholder={copy.questions.sectionDescriptionPlaceholder} className="field h-[46px] py-0" />
            </label>
            <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="adminOnly" className="accent-accent" /> {copy.questions.sectionAdminOnly}
            </label>
            <button type="submit" className="btn btn-primary mt-3">{copy.questions.sectionCreate}</button>
          </form>
        </section>
      ) : null}

      {manages ? <EventsPanel /> : null}

      {manages ? (
        <form action={addFromPacksAction} className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.packsTitle}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{copy.questions.packsDescription}</p>
          <QuestionPackPicker
            packs={QUESTION_PACKS}
            selected={picked}
            onToggleQuestion={toggleQuestion}
            onTogglePack={togglePack}
            ariaLabel={copy.questions.packsTitle}
          />
          {picked.map((question) => (
            <input key={question} type="hidden" name="question" value={question} />
          ))}
          <div className="mt-4 flex items-center gap-3">
            <span className="chip border bg-card px-2.5 py-1 text-[12px] font-bold text-ink-soft numeric">
              {text(copy.common.selectedCount, { count: picked.length })}
            </span>
            <button type="submit" disabled={addable === 0} className="btn btn-primary">
              {copy.questions.addToPool}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}

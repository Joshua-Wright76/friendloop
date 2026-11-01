"use client";

import Link from "next/link";
import { useState } from "react";
import {
  acceptSuggestionAction,
  addAction,
  addFromPacksAction,
  archiveSectionAction,
  createSectionAction,
  declineSuggestionAction,
  moveSectionAction,
  rotationAction,
  updateSectionAction,
} from "./actions";
import { QuestionOrder } from "./question-order";
import { LoopNav } from "@/components/loop-nav";
import { Picker } from "@/components/picker";
import { QuestionPackPicker } from "@/components/question-pack-picker";
import { QUESTION_PACKS, newQuestionTexts } from "@/lib/question-packs";
import { copy, text } from "@/lib/copy";
import { useLoopData } from "../loop-data";

const ROTATION_OPTIONS = [
  { value: "", label: copy.questions.allQuestions },
  ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) })),
];

export default function QuestionsTab({ notices }: { notices: { added?: string; archived?: string; rotation?: string; fromPacks?: string; suggestion?: string; section?: string } }) {
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

      {notices.added ? <Notice>{copy.questions.addedNotice}</Notice> : null}
      {notices.archived ? <Notice>{copy.questions.archivedNotice}</Notice> : null}
      {notices.suggestion === "added" ? <Notice>{copy.questions.suggestionAddedNotice}</Notice> : null}
      {notices.suggestion === "declined" ? <Notice>{copy.questions.suggestionDeclinedNotice}</Notice> : null}
      {notices.suggestion === "gone" ? <Notice>{copy.questions.suggestionGoneNotice}</Notice> : null}
      {notices.section === "created" ? <Notice>{copy.questions.sectionCreatedNotice}</Notice> : null}
      {notices.section === "saved" ? <Notice>{copy.questions.sectionSavedNotice}</Notice> : null}
      {notices.section === "archived" ? <Notice>{copy.questions.sectionArchivedNotice}</Notice> : null}
      {notices.section === "moved" ? <Notice>{copy.questions.sectionMovedNotice}</Notice> : null}
      {notices.section === "invalid" ? <Notice>{copy.reply.errors.sectionSaveFailed}</Notice> : null}
      {notices.rotation === "1" ? <Notice>{copy.questions.rotationSaved}</Notice> : null}
      {notices.rotation === "invalid" ? <Notice>{copy.questions.rotationInvalid}</Notice> : null}
      {notices.fromPacks === "0" ? <Notice>{copy.questions.fromPacksNone}</Notice> : null}
      {notices.fromPacks && notices.fromPacks !== "0" ? (
        <Notice>
          {Number(notices.fromPacks) === 1
            ? copy.questions.fromPacksAddedOne
            : text(copy.questions.fromPacksAdded, { count: notices.fromPacks })}
        </Notice>
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
                  <input
                    name="text"
                    required
                    maxLength={200}
                    defaultValue={suggestion.text}
                    aria-label={copy.questions.suggestionTextLabel}
                    className="field h-[46px] py-0"
                  />
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

      {manages && pool.length ? <QuestionOrder groupId={id} questions={pool.map(({ id: questionId, text, skipNext }) => ({ id: questionId, text, skipNext }))} /> : (
        <ol className="mt-5 flex flex-col gap-2.5" aria-label={copy.questions.listLabel}>
          {pool.map((question, index) => <li key={question.id} className="card paper p-4"><div className="flex items-start gap-3"><span className="question-number">{index + 1}</span><div><p className="text-[15px] font-medium leading-snug text-ink">{question.text}</p>{question.skipNext ? <p className="mt-1 text-[12px] font-medium text-ink-muted">{copy.questions.skipNextNote}</p> : null}</div></div></li>)}
          {pool.length === 0 ? <li className="card p-5 text-[14px] text-ink-muted"><p>{copy.questions.empty}</p>{manages ? <a href="#question-form" className="btn btn-primary mt-4 inline-flex">{copy.questions.firstQuestionAction}</a> : null}</li> : null}
        </ol>
      )}

      {manages ? (
        <form action={addAction} id="question-form" className="card mt-5 p-5">
          <input type="hidden" name="groupId" value={id} />
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">{copy.questions.addTitle}</h2>
          <input
            name="text"
            required
            maxLength={200}
            placeholder={copy.questions.newQuestionPlaceholder}
            aria-label={copy.questions.newQuestionAriaLabel}
            className="field mt-3 h-[46px] py-0"
          />
          <button type="submit" className="btn btn-primary mt-3">
            {copy.questions.add}
          </button>
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
                        <button type="submit" aria-label={copy.questions.sectionUpLabel} disabled={index === 0} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionUp}</button>
                      </form>
                      <form action={moveSectionAction}>
                        <input type="hidden" name="groupId" value={id} />
                        <input type="hidden" name="sectionId" value={section.id} />
                        <input type="hidden" name="targetIndex" value={index + 1} />
                        <button type="submit" aria-label={copy.questions.sectionDownLabel} disabled={index === sections.length - 1} className="btn btn-quiet min-h-11 px-3 text-[13px]">{copy.questions.sectionDown}</button>
                      </form>
                    </div>
                  </div>
                  <p className="mt-0.5 text-[12px] font-medium text-ink-muted">
                    {section.kind === "photo_wall" ? copy.questions.sectionKindPhotoWall : section.kind === "music" ? copy.questions.sectionKindMusic : copy.questions.sectionKindStandard}
                    {section.adminOnly ? ` · ${copy.questions.sectionAdminOnly}` : ""}
                  </p>
                  {section.description ? <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{section.description}</p> : null}
                  <details className="mt-2">
                    <summary className="min-h-11 cursor-pointer text-[13px] font-bold text-ink leading-[44px]">{copy.questions.sectionEdit}</summary>
                    <form action={updateSectionAction} className="mt-2 flex flex-col gap-2">
                      <input type="hidden" name="groupId" value={id} />
                      <input type="hidden" name="sectionId" value={section.id} />
                      <input name="title" defaultValue={section.title} maxLength={80} required aria-label={copy.questions.sectionTitleLabel} className="field h-[46px] py-0" />
                      <input name="emoji" defaultValue={section.emoji ?? ""} maxLength={8} aria-label={copy.questions.sectionEmojiLabel} className="field h-[46px] py-0" />
                      <input name="description" defaultValue={section.description ?? ""} maxLength={200} placeholder={copy.questions.sectionDescriptionPlaceholder} aria-label={copy.questions.sectionDescriptionLabel} className="field h-[46px] py-0" />
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
                  <form action={archiveSectionAction} className="mt-2">
                    <input type="hidden" name="groupId" value={id} />
                    <input type="hidden" name="sectionId" value={section.id} />
                    <button type="submit" className="btn btn-quiet min-h-11 px-4 text-[13px]">{copy.questions.sectionArchive}</button>
                  </form>
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
              <input name="title" required maxLength={80} placeholder={copy.questions.sectionTitlePlaceholder} aria-label={copy.questions.sectionTitleLabel} className="field h-[46px] py-0" />
              <input name="emoji" maxLength={8} aria-label={copy.questions.sectionEmojiLabel} className="field h-[46px] py-0" />
            </div>
            <select name="kind" aria-label={copy.questions.sectionKindLabel} className="field mt-2 h-[46px] py-0" defaultValue="standard">
              <option value="standard">{copy.questions.sectionKindStandard}</option>
              <option value="photo_wall">{copy.questions.sectionKindPhotoWall}</option>
              <option value="music">{copy.questions.sectionKindMusic}</option>
            </select>
            <input name="description" maxLength={200} placeholder={copy.questions.sectionDescriptionPlaceholder} aria-label={copy.questions.sectionDescriptionLabel} className="field mt-2 h-[46px] py-0" />
            <label className="mt-2 flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="adminOnly" className="accent-accent" /> {copy.questions.sectionAdminOnly}
            </label>
            <button type="submit" className="btn btn-primary mt-3">{copy.questions.sectionCreate}</button>
          </form>
        </section>
      ) : null}

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

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="notice settle mt-4 border bg-accent-soft px-4 py-3 text-[14px] leading-relaxed">
      {children}
    </div>
  );
}

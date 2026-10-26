"use client";

import { useActionState, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createLoopAction, type CreateState } from "./actions";
import { TimezoneField } from "./timezone-field";
import { Tape } from "@/components/stationery";
import { Picker } from "@/components/picker";
import { copy, text } from "@/lib/copy";

const WEEKDAYS = copy.common.weekdays;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAY_OPTIONS = WEEKDAYS.map((day, index) => ({ value: String(index), label: day }));
const HOUR_OPTIONS = HOURS.map((hour) => ({
  value: String(hour),
  label: text(copy.newLoop.wizard.details.hourOption, { hour: String(hour).padStart(2, "0") }),
}));
const CADENCE_OPTIONS = copy.newLoop.cadences;
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ModalKind = "name-ideas" | "question" | "section" | "preview" | null;
type SectionPreset = (typeof copy.newLoop.wizard.sections.presets)[number];
type CustomSection = { id: number; title: string; description: string };

function sectionQuestion(title: string, description: string): string {
  return text(copy.newLoop.wizard.sections.questionFormat, { title, description });
}

function IconClose() {
  return <span aria-hidden="true" className="text-[26px] font-normal leading-none">×</span>;
}

function IconPlus() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path d="M10 4v12M4 10h12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function IconRemove() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
      <path d="m5 5 10 10M15 5 5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function AccessibleDialog({
  open,
  title,
  description,
  closeLabel,
  onClose,
  children,
  className = "",
}: {
  open: boolean;
  title: string;
  description?: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      className={`wizard-dialog ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="wizard-dialog__header">
        <div>
          <h2 id={titleId} className="font-display text-[30px] font-bold leading-tight text-ink">{title}</h2>
          {description ? <p id={descriptionId} className="mt-1 text-[14px] leading-relaxed text-ink-soft">{description}</p> : null}
        </div>
        <button type="button" aria-label={closeLabel} onClick={onClose} className="btn btn-quiet h-11 min-h-11 w-11 flex-none px-0">
          <IconClose />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function NewLoopForm({ bank }: { bank: Array<{ group: string; questions: string[] }> }) {
  const [state, action, pending] = useActionState(createLoopAction, {} as CreateState);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [cadence, setCadence] = useState("1");
  const [weekday, setWeekday] = useState("5");
  const [hour, setHour] = useState("9");
  const [timezone, setTimezone] = useState("");
  const [picked, setPicked] = useState<string[]>(() => bank.flatMap((group) => group.questions).slice(0, 2));
  const [customQuestions, setCustomQuestions] = useState<Array<{ id: number; value: string }>>([]);
  const [pickedPresets, setPickedPresets] = useState<string[]>([]);
  const [customSections, setCustomSections] = useState<CustomSection[]>([]);
  const [emails, setEmails] = useState<string[]>([]);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailError, setEmailError] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const [personalNote, setPersonalNote] = useState("");
  const [questionDraft, setQuestionDraft] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");
  const [sectionDescription, setSectionDescription] = useState("");
  const [modalError, setModalError] = useState("");
  const [stepError, setStepError] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const nextQuestionId = useRef(0);
  const nextSectionId = useRef(0);
  const errorId = useId();
  const stepHeading = useRef<HTMLHeadingElement>(null);

  const presets = copy.newLoop.wizard.sections.presets;
  const questions = [
    ...picked,
    ...customQuestions.map((question) => question.value.trim()).filter(Boolean),
    ...pickedPresets.flatMap((id) => {
      const preset = presets.find((item) => item.id === id);
      return preset ? [sectionQuestion(preset.title, preset.description)] : [];
    }),
    ...customSections.map((section) => sectionQuestion(section.title, section.description)),
  ];
  const selectedCadence = CADENCE_OPTIONS.find((option) => option.value === cadence) ?? CADENCE_OPTIONS[0];
  const currentStepLabel = copy.newLoop.wizard.steps[step];

  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);

  function toggleQuestion(question: string) {
    setPicked((current) => current.includes(question)
      ? current.filter((item) => item !== question)
      : [...current, question]);
  }

  function addCustomQuestion() {
    const value = questionDraft.trim();
    if (!value) {
      setModalError(copy.newLoop.wizard.questions.questionRequired);
      return;
    }
    setCustomQuestions((current) => [...current, { id: nextQuestionId.current++, value }]);
    setQuestionDraft("");
    setModalError("");
    setModal(null);
  }

  function addCustomSection() {
    const title = sectionTitle.trim();
    const description = sectionDescription.trim();
    if (!title || !description) {
      setModalError(copy.newLoop.errors.section);
      return;
    }
    setCustomSections((current) => [...current, { id: nextSectionId.current++, title, description }]);
    setSectionTitle("");
    setSectionDescription("");
    setModalError("");
    setModal(null);
  }

  function addEmails(raw: string): boolean {
    const parsed = raw.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean);
    if (parsed.some((email) => !VALID_EMAIL.test(email))) {
      setEmailError(copy.newLoop.wizard.readers.invalidEmail);
      setEmailNotice("");
      return false;
    }
    if (parsed.length === 0) return true;

    const existing = new Set(emails);
    const duplicate = parsed.some((email) => existing.has(email));
    setEmails((current) => [...new Set([...current, ...parsed])]);
    setEmailDraft("");
    setEmailError("");
    setEmailNotice(duplicate || new Set(parsed).size !== parsed.length ? copy.newLoop.wizard.readers.duplicateEmail : "");
    return true;
  }

  function handleEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", " "].includes(event.key) && emailDraft.trim()) {
      event.preventDefault();
      addEmails(emailDraft);
    } else if (event.key === "Backspace" && !emailDraft && emails.length > 0) {
      setEmails((current) => current.slice(0, -1));
    }
  }

  function goNext() {
    setStepError("");
    if (step === 0) {
      if (name.trim().length < 2) {
        setStepError(copy.newLoop.errors.name);
        return;
      }
      if (!timezone) {
        setStepError(copy.newLoop.errors.timezone);
        return;
      }
    }
    if (step === 3) {
      if (emailDraft.trim() && !addEmails(emailDraft)) return;
      if (questions.length === 0) {
        setStepError(copy.newLoop.errors.noQuestions);
        return;
      }
    }
    setStep((current) => Math.min(current + 1, copy.newLoop.wizard.steps.length - 1));
  }

  function goBack() {
    setStepError("");
    setStep((current) => Math.max(current - 1, 0));
  }

  function openModal(kind: Exclude<ModalKind, null>) {
    setModalError("");
    setModal(kind);
  }

  const error = state.error || stepError;

  return (
    <form
      action={action}
      className="new-loop-wizard"
      onSubmit={(event) => {
        if (step !== copy.newLoop.wizard.steps.length - 1) event.preventDefault();
      }}
    >
      <input type="hidden" name="name" value={name} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="weekday" value={weekday} />
      <input type="hidden" name="hour" value={hour} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="participation" value="contributor" />
      <input type="hidden" name="personalNote" value={personalNote} />
      {questions.map((question, index) => <input key={`${index}:${question}`} type="hidden" name="question" value={question} />)}
      {emails.map((email) => <input key={email} type="hidden" name="email" value={email} />)}

      <div className="wizard-progress">
        <div className="wizard-progress__row">
          <span className="text-[13px] font-bold text-ink-soft">
            {text(copy.newLoop.wizard.details.stepCounter, { current: step + 1, total: copy.newLoop.wizard.steps.length })}
          </span>
          <span className="min-w-0 truncate text-[13px] font-bold text-ink">{currentStepLabel}</span>
        </div>
        <div
          className="wizard-progress__track"
          role="progressbar"
          aria-label={copy.newLoop.wizard.stepAriaLabel}
          aria-valuemin={1}
          aria-valuemax={copy.newLoop.wizard.steps.length}
          aria-valuenow={step + 1}
          aria-valuetext={text(copy.newLoop.wizard.progressValue, {
            current: step + 1,
            total: copy.newLoop.wizard.steps.length,
            label: currentStepLabel,
          })}
        >
          <span style={{ width: `${((step + 1) / copy.newLoop.wizard.steps.length) * 100}%` }} />
        </div>
      </div>

      <section className="wizard-step" aria-labelledby="wizard-step-heading">
        {step === 0 ? (
          <>
            <h1 ref={stepHeading} tabIndex={-1} id="wizard-step-heading" className="wizard-heading">{copy.newLoop.wizard.details.title}</h1>
            <p className="wizard-description">{copy.newLoop.wizard.details.description}</p>
            <div className="card relative mt-6 p-5 pt-7 sm:p-6 sm:pt-8">
              <Tape tone="stripe" position="right" />
              <div className="flex items-end justify-between gap-3">
                <label htmlFor="loop-name" className="font-display text-[23px] font-bold text-ink">{copy.newLoop.nameLabel}</label>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={modal === "name-ideas"}
                  onClick={() => openModal("name-ideas")}
                  className="btn btn-quiet h-10 min-h-10 px-3 text-[13px]"
                >
                  {copy.newLoop.wizard.details.ideasButton}
                </button>
              </div>
              <input
                id="loop-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={60}
                placeholder={copy.newLoop.namePlaceholder}
                autoComplete="off"
                aria-describedby={error ? errorId : undefined}
                className="field mt-2 h-[48px] py-0 text-[16px]"
              />

              <fieldset className="mt-6">
                <legend className="mb-2 text-[14px] font-bold text-ink">{copy.newLoop.wizard.details.cadence}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {CADENCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={cadence === option.value}
                      onClick={() => setCadence(option.value)}
                      className={`wizard-pill ${cadence === option.value ? "wizard-pill--selected" : ""}`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <p className="mt-5 text-[13px] font-medium text-ink-soft">{copy.newLoop.wizard.details.schedule}</p>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.day}</span>
                  <Picker name="__weekday" value={weekday} defaultValue="5" options={WEEKDAY_OPTIONS} ariaLabel={copy.newLoop.day} onValueChange={setWeekday} />
                </label>
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.time}</span>
                  <Picker name="__hour" value={hour} defaultValue="9" options={HOUR_OPTIONS} ariaLabel={copy.newLoop.time} onValueChange={setHour} />
                </label>
                <label className="col-span-2 flex min-w-0 flex-col gap-1.5">
                  <span className="text-[13px] font-medium text-ink-soft">{copy.newLoop.timezone}</span>
                  <TimezoneField name="__timezone" value={timezone || undefined} onValueChange={setTimezone} />
                </label>
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 ref={stepHeading} tabIndex={-1} id="wizard-step-heading" className="wizard-heading">{copy.newLoop.wizard.questions.title}</h1>
                <p className="wizard-description">{copy.newLoop.wizard.questions.description}</p>
              </div>
              <span className="chip border bg-card px-3 py-1.5 text-[13px] font-bold text-ink-soft numeric">
                {text(copy.newLoop.wizard.questions.selected, { count: questions.length })}
              </span>
            </div>
            <div className="mt-5 flex flex-col gap-3">
              {bank.map((group) => (
                <fieldset key={group.group} className="card p-3 sm:p-4">
                  <legend className="px-2 font-display text-[20px] font-bold text-ink">{group.group}</legend>
                  <div className="flex flex-col">
                    {group.questions.map((question) => (
                      <label key={question} className="wizard-question-row">
                        <input
                          type="checkbox"
                          checked={picked.includes(question)}
                          onChange={() => toggleQuestion(question)}
                          className="mt-1 h-4 w-4 flex-none accent-[var(--accent)]"
                        />
                        <span className="text-[15px] leading-snug text-ink">{question}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}

              {customQuestions.map((question, index) => (
                <div key={question.id} className="wizard-saved-prompt">
                  <span className="min-w-0 flex-1 text-[15px] leading-snug text-ink">{question.value}</span>
                  <button
                    type="button"
                    aria-label={text(copy.newLoop.wizard.questions.removeQuestion, { number: index + 1 })}
                    onClick={() => setCustomQuestions((current) => current.filter((item) => item.id !== question.id))}
                    className="btn btn-quiet h-10 min-h-10 w-10 flex-none px-0"
                  >
                    <IconRemove />
                  </button>
                </div>
              ))}
              {picked.length + customQuestions.length === 0 ? (
                <p className="rounded-md border border-dashed border-line-strong px-4 py-3 text-[14px] leading-relaxed text-ink-soft">{copy.newLoop.wizard.questions.empty}</p>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setQuestionDraft("");
                  openModal("question");
                }}
                className="btn btn-quiet mt-1 min-h-11 justify-start gap-2 px-4 text-[14px]"
              >
                <IconPlus />
                {copy.newLoop.wizard.questions.addOwn}
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 ref={stepHeading} tabIndex={-1} id="wizard-step-heading" className="wizard-heading">{copy.newLoop.wizard.sections.title}</h1>
            <p className="wizard-description">{copy.newLoop.wizard.sections.description}</p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
              {presets.map((preset: SectionPreset) => {
                const selected = pickedPresets.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPickedPresets((current) => selected
                      ? current.filter((id) => id !== preset.id)
                      : [...current, preset.id])}
                    className={`wizard-preset ${selected ? "wizard-preset--selected" : ""}`}
                  >
                    <span className="wizard-preset__emoji" aria-hidden="true">{preset.emoji}</span>
                    <span className="min-w-0 flex-1">
                      <span className="wizard-preset__title">{preset.title}</span>
                      <span className="wizard-preset__description">{preset.description}</span>
                    </span>
                    <span className="wizard-preset__check" aria-hidden="true">{selected ? <svg viewBox="0 0 20 20" className="h-4 w-4"><path d="m4 10 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}</span>
                  </button>
                );
              })}
            </div>

            {customSections.map((section, index) => (
              <div key={section.id} className="wizard-saved-prompt mt-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink">{section.title}</span>
                  <span className="mt-0.5 block text-[14px] leading-relaxed text-ink-soft">{section.description}</span>
                </span>
                <button
                  type="button"
                  aria-label={text(copy.newLoop.wizard.sections.remove, { number: index + 1 })}
                  onClick={() => setCustomSections((current) => current.filter((item) => item.id !== section.id))}
                  className="btn btn-quiet h-10 min-h-10 w-10 flex-none px-0"
                >
                  <IconRemove />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setSectionTitle("");
                setSectionDescription("");
                openModal("section");
              }}
              className="btn btn-quiet mt-3 min-h-11 justify-start gap-2 px-4 text-[14px]"
            >
              <IconPlus />
              {copy.newLoop.wizard.sections.custom}
            </button>
            <p className="mt-4 rounded-md border border-dashed border-accent-line bg-card/70 px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
              {text(copy.newLoop.wizard.questions.questionCount, { count: questions.length })}
            </p>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 ref={stepHeading} tabIndex={-1} id="wizard-step-heading" className="wizard-heading">{copy.newLoop.wizard.readers.title}</h1>
            <p className="wizard-description">{copy.newLoop.wizard.readers.groupDescription}</p>
            <div className="mt-5">
              <label htmlFor="reader-emails" className="mb-2 block text-[14px] font-bold text-ink">{copy.newLoop.wizard.readers.emailLabel}</label>
              <div className="flex items-start gap-3">
              <div
                className={`field flex min-h-[52px] flex-1 flex-wrap items-center gap-2 p-2 ${emailError ? "border-danger" : ""}`}
                onClick={(event) => event.currentTarget.querySelector("input")?.focus()}
              >
                {emails.map((email) => (
                  <span key={email} className="chip inline-flex min-h-9 items-center gap-1.5 border bg-card pr-1 text-[13px] font-bold text-ink">
                    <span>{email}</span>
                    <button
                      type="button"
                      aria-label={text(copy.newLoop.wizard.readers.removeEmail, { email })}
                      onClick={() => setEmails((current) => current.filter((item) => item !== email))}
                      className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-muted hover:bg-field hover:text-ink"
                    >
                      <IconRemove />
                    </button>
                  </span>
                ))}
                <input
                  id="reader-emails"
                  value={emailDraft}
                  onChange={(event) => {
                    setEmailDraft(event.target.value);
                    setEmailError("");
                    setEmailNotice("");
                  }}
                  onKeyDown={handleEmailKeyDown}
                  placeholder={copy.newLoop.wizard.readers.emailPlaceholder}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? errorId : undefined}
                  autoComplete="email"
                  className="min-w-[180px] flex-1 border-0 bg-transparent p-1 text-[14px] text-ink outline-none"
                />
              </div>
              <button type="button" onClick={() => addEmails(emailDraft)} className="btn btn-quiet h-[46px] min-h-[46px] flex-none px-4 text-[13px]">
                {copy.newLoop.wizard.readers.addEmail}
              </button>
              </div>
              {emailError ? <p id={errorId} role="alert" className="mt-2 text-[13px] leading-relaxed text-danger">{emailError}</p> : null}
              {emailNotice ? <p role="status" className="mt-2 text-[13px] leading-relaxed text-ink-soft">{emailNotice}</p> : null}
              <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">{copy.newLoop.wizard.readers.optional}</p>
            </div>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <h1 ref={stepHeading} tabIndex={-1} id="wizard-step-heading" className="wizard-heading">{copy.newLoop.wizard.note.title}</h1>
            <p className="wizard-description">{copy.newLoop.wizard.note.description}</p>
            <div className="card relative mt-5 p-5 pt-7">
              <Tape tone="dots" />
              <label htmlFor="personal-note" className="mb-2 block text-[14px] font-bold text-ink">{copy.newLoop.wizard.note.label}</label>
              <textarea
                id="personal-note"
                value={personalNote}
                onChange={(event) => setPersonalNote(event.target.value)}
                maxLength={1000}
                rows={5}
                placeholder={copy.newLoop.wizard.note.placeholder}
                className="field min-h-[130px] resize-y leading-relaxed"
              />
              <div className="mt-5 border-t border-dashed border-accent-line pt-4">
                <h2 className="font-display text-[23px] font-bold text-ink">{copy.newLoop.wizard.note.newsletterCardTitle}</h2>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{copy.newLoop.wizard.note.newsletterCardDescription}</p>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={modal === "preview"}
                  onClick={() => openModal("preview")}
                  className="btn btn-quiet mt-4 h-11 min-h-11 px-4"
                >
                  {copy.newLoop.wizard.note.previewButton}
                </button>
              </div>
            </div>
          </>
        ) : null}

        {error ? <p id={errorId} role="alert" className="mt-4 text-[14px] leading-snug text-danger">{error}</p> : null}
      </section>

      <nav aria-label={copy.newLoop.wizard.stepAriaLabel} className="wizard-navigation">
        <button
          type="button"
          onClick={goBack}
          disabled={step === 0 || pending}
          aria-label={copy.newLoop.wizard.backAriaLabel}
          className="btn btn-quiet min-h-12 px-4 disabled:opacity-40"
        >
          {copy.newLoop.wizard.back}
        </button>
        {step < copy.newLoop.wizard.steps.length - 1 ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              goNext();
            }}
            disabled={pending}
            aria-label={copy.newLoop.wizard.nextAriaLabel}
            className="btn btn-primary min-h-12 flex-1"
          >
            {copy.newLoop.wizard.next}
          </button>
        ) : (
          <button
            type="submit"
            disabled={pending}
            aria-label={copy.newLoop.wizard.createAriaLabel}
            className="btn btn-primary min-h-12 flex-1 disabled:opacity-60"
          >
            {pending ? copy.newLoop.wizard.creating : copy.newLoop.wizard.create}
          </button>
        )}
      </nav>

      <AccessibleDialog
        open={modal === "name-ideas"}
        title={copy.newLoop.wizard.details.ideasTitle}
        description={copy.newLoop.wizard.details.ideasDescription}
        closeLabel={copy.newLoop.wizard.details.closeIdeas}
        onClose={() => setModal(null)}
        className="wizard-dialog--wide"
      >
        <div className="mt-5 flex max-h-[62dvh] flex-col gap-5 overflow-y-auto pr-1">
          {copy.newLoop.wizard.details.ideasGroups.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-2 font-display text-[21px] font-bold text-ink">{group.title}</h3>
              <div className="grid gap-2">
                {group.ideas.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    onClick={() => {
                      setName(idea);
                      setModal(null);
                    }}
                    className="wizard-idea"
                  >
                    <span>{idea}</span>
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4 text-ink-muted"><path d="M6 6h8v8M14 6 5 15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </AccessibleDialog>

      <AccessibleDialog
        open={modal === "question"}
        title={copy.newLoop.wizard.questions.addOwnTitle}
        closeLabel={copy.newLoop.wizard.questions.closeQuestion}
        onClose={() => setModal(null)}
      >
        <label htmlFor="question-draft" className="mt-5 block text-[14px] font-bold text-ink">{copy.newLoop.wizard.questions.questionLabel}</label>
        <input
          id="question-draft"
          value={questionDraft}
          onChange={(event) => {
            setQuestionDraft(event.target.value);
            setModalError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustomQuestion();
            }
          }}
          maxLength={200}
          autoFocus
          placeholder={copy.newLoop.wizard.questions.questionPlaceholder}
          className="field mt-1 h-[48px] py-0"
        />
        {modalError ? <p role="alert" className="mt-2 text-[13px] text-danger">{modalError}</p> : null}
        <button type="button" onClick={addCustomQuestion} className="btn btn-primary mt-4 w-full min-h-12">
          {copy.newLoop.wizard.questions.saveQuestion}
        </button>
      </AccessibleDialog>

      <AccessibleDialog
        open={modal === "section"}
        title={copy.newLoop.wizard.sections.customTitle}
        closeLabel={copy.newLoop.wizard.sections.closeCustom}
        onClose={() => setModal(null)}
      >
        <label htmlFor="section-title" className="mt-5 block text-[14px] font-bold text-ink">{copy.newLoop.wizard.sections.titleLabel}</label>
        <input
          id="section-title"
          value={sectionTitle}
          onChange={(event) => {
            setSectionTitle(event.target.value);
            setModalError("");
          }}
          maxLength={60}
          autoFocus
          placeholder={copy.newLoop.wizard.sections.titlePlaceholder}
          className="field mt-1 h-[48px] py-0"
        />
        <label htmlFor="section-description" className="mt-4 block text-[14px] font-bold text-ink">{copy.newLoop.wizard.sections.descriptionLabel}</label>
        <textarea
          id="section-description"
          value={sectionDescription}
          onChange={(event) => {
            setSectionDescription(event.target.value);
            setModalError("");
          }}
          maxLength={180}
          rows={3}
          placeholder={copy.newLoop.wizard.sections.descriptionPlaceholder}
          className="field mt-1 resize-y"
        />
        {modalError ? <p role="alert" className="mt-2 text-[13px] text-danger">{modalError}</p> : null}
        <button type="button" onClick={addCustomSection} className="btn btn-primary mt-4 w-full min-h-12">
          {copy.newLoop.wizard.sections.save}
        </button>
      </AccessibleDialog>

      <AccessibleDialog
        open={modal === "preview"}
        title={copy.newLoop.wizard.note.previewTitle}
        description={copy.newLoop.wizard.note.previewDescription}
        closeLabel={copy.newLoop.wizard.note.closePreview}
        onClose={() => setModal(null)}
        className="wizard-dialog--wide"
      >
        <article className="wizard-newsletter-preview">
          <div className="text-center">
            <span className="wizard-newsletter-preview__mark" aria-hidden="true">{copy.common.cherry}</span>
            <h3 className="mt-3 font-display text-[32px] font-bold leading-tight text-ink">{name || copy.newLoop.namePlaceholder}</h3>
            <p className="mt-1 text-[13px] font-bold text-ink-muted">{copy.common.brand}</p>
          </div>
          <p className="mt-5 border-y border-line py-3 text-[13px] leading-relaxed text-ink-soft">
            {text(copy.newLoop.wizard.note.previewSchedule, {
              cadence: selectedCadence.label,
              weekday: WEEKDAYS[Number(weekday)] ?? WEEKDAYS[5],
              hour: hour.padStart(2, "0"),
              timezone: timezone || copy.newLoop.timezone,
            })}
          </p>
          <h4 className="mt-5 font-display text-[22px] font-bold text-ink">{copy.newLoop.wizard.note.previewQuestions}</h4>
          <ol className="mt-2 flex flex-col gap-2">
            {questions.map((question, index) => (
              <li key={`${index}:${question}`} className="wizard-newsletter-preview__question">
                <span className="question-number">{index + 1}</span>
                <span>{question}</span>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-[13px] leading-relaxed text-ink-soft">
            {emails.length > 0
              ? text(copy.newLoop.wizard.note.previewReaders, { count: emails.length })
              : copy.newLoop.wizard.note.previewNoReaders}
          </p>
          <div className="mt-4 rounded-md bg-accent-soft p-3">
            <p className="text-[12px] font-bold uppercase tracking-wide text-ink-soft">{copy.newLoop.wizard.note.previewNote}</p>
            <p className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
              {personalNote.trim() || copy.newLoop.wizard.note.emptyNote}
            </p>
          </div>
        </article>
      </AccessibleDialog>
    </form>
  );
}

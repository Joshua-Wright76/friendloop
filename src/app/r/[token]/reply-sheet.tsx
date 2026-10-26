"use client";

/* eslint-disable @next/next/no-img-element -- Uploaded photos use local URLs in development and Blob URLs in production. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Deadline } from "@/lib/schedule";
import { Cherries, Tape, ThemeMark } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { MAX_PHOTO_BYTES, PHOTO_ACCEPT } from "@/lib/photo-validation";
import type { IssueTheme, QuestionKind } from "@/lib/issue-experience";
import {
  createSerialDraftWriter,
  postReply,
  removeReplyPhoto,
  uploadReplyPhoto,
} from "@/lib/reply-client";

export type SheetQuestion = {
  id: string;
  index: number;
  text: string;
  kind: QuestionKind;
  body: string;
  photoUrl: string | null;
  submitted: boolean;
};

type Props = {
  token: string;
  loopName: string;
  roundNumber: number;
  deadline: Deadline;
  displayName: string;
  theme: IssueTheme;
  mood: string | null;
  questions: SheetQuestion[];
};

type SaveStatus = "idle" | "saving" | "saved" | "error";
type QuestionSaveStatus = "empty" | "saving" | "saved" | "error";
type PhotoStatus = "idle" | "uploading" | "saved" | "removing" | "removed" | "uploadError" | "removeError";

export function ReplySheet({
  token,
  loopName,
  roundNumber,
  deadline,
  displayName,
  theme,
  mood: initialMood,
  questions,
}: Props) {
  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.body])),
  );
  const [mood, setMood] = useState(initialMood ?? "");
  const [moodStatus, setMoodStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [submitFailed, setSubmitFailed] = useState(false);
  const [questionStatuses, setQuestionStatuses] = useState<Record<string, QuestionSaveStatus>>(() =>
    Object.fromEntries(questions.map((question) => [
      question.id,
      question.body.trim() || question.photoUrl ? "saved" : "empty",
    ])),
  );
  const [photoUrls, setPhotoUrls] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.photoUrl])),
  );
  const [photoPreviews, setPhotoPreviews] = useState<Record<string, string | null>>({});
  const [photoStates, setPhotoStates] = useState<Record<string, PhotoStatus>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, "idle"])),
  );
  const [photoErrors, setPhotoErrors] = useState<Record<string, string | null>>({});
  const [retryablePhotos, setRetryablePhotos] = useState<Record<string, boolean>>({});
  const [sent, setSent] = useState(() => questions.some((question) => question.submitted));
  const [animateSentStamp, setAnimateSentStamp] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const revisions = useRef(new Map<string, number>());
  const fields = useRef(new Map<string, HTMLTextAreaElement>());
  const photoFiles = useRef(new Map<string, File>());
  const photoObjectUrls = useRef(new Map<string, string>());
  const photoLocks = useRef(new Set<string>());

  const total = questions.length;
  const writeDraft = useMemo(
    () => createSerialDraftWriter((questionId, body) => postReply(
      token,
      { action: "draft", issueQuestionId: questionId, body },
      copy.reply.genericError,
    )),
    [token],
  );
  const writeMood = useMemo(
    () => createSerialDraftWriter((_key, emoji) => postReply(
      token,
      { action: "mood", emoji },
      copy.reply.moodError,
    )),
    [token],
  );
  const answered = useMemo(
    () => questions.filter((question) =>
      (bodies[question.id] ?? "").trim().length > 0 || Boolean(photoUrls[question.id]),
    ).length,
    [bodies, photoUrls, questions],
  );
  const photoBusy = useMemo(
    () => Object.values(photoStates).some((state) => state === "uploading" || state === "removing"),
    [photoStates],
  );
  const status: SaveStatus = useMemo(() => {
    const states = Object.values(questionStatuses);
    if (submitFailed || states.includes("error")) return "error";
    if (states.includes("saving")) return "saving";
    if (states.includes("saved")) return "saved";
    return "idle";
  }, [questionStatuses, submitFailed]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  useEffect(() => () => {
    for (const objectUrl of photoObjectUrls.current.values()) URL.revokeObjectURL(objectUrl);
    photoObjectUrls.current.clear();
  }, []);

  const autosize = useCallback((element: HTMLTextAreaElement) => {
    element.style.height = "auto";
    element.style.height = `${Math.max(element.scrollHeight, 72)}px`;
  }, []);

  const clearPhotoPreview = useCallback((questionId: string) => {
    const objectUrl = photoObjectUrls.current.get(questionId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    photoObjectUrls.current.delete(questionId);
    setPhotoPreviews((current) => ({ ...current, [questionId]: null }));
  }, []);

  const uploadPhoto = useCallback(async (questionId: string, file: File) => {
    if (photoLocks.current.has(questionId)) return;
    photoLocks.current.add(questionId);
    setPhotoStates((current) => ({ ...current, [questionId]: "uploading" }));
    setPhotoErrors((current) => ({ ...current, [questionId]: null }));

    const result = await uploadReplyPhoto(
      token,
      questionId,
      file,
      copy.reply.errors.photoUploadFailed,
    );
    photoLocks.current.delete(questionId);

    if (result.ok) {
      setPhotoUrls((current) => ({ ...current, [questionId]: result.photoUrl }));
      photoFiles.current.delete(questionId);
      setRetryablePhotos((current) => ({ ...current, [questionId]: false }));
      setPhotoStates((current) => ({ ...current, [questionId]: "saved" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: null }));
    } else {
      setPhotoStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: result.error }));
    }
    clearPhotoPreview(questionId);
  }, [clearPhotoPreview, token]);

  const selectPhoto = useCallback((questionId: string, file: File) => {
    const supportedTypes = PHOTO_ACCEPT.split(",");
    const error = file.size > MAX_PHOTO_BYTES
      ? copy.reply.errors.photoTooLarge
      : file.type && !supportedTypes.includes(file.type)
        ? copy.reply.errors.invalidPhoto
        : null;

    if (error) {
      photoFiles.current.delete(questionId);
      setRetryablePhotos((current) => ({ ...current, [questionId]: false }));
      clearPhotoPreview(questionId);
      setPhotoStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: error }));
      return;
    }

    photoFiles.current.set(questionId, file);
    setRetryablePhotos((current) => ({ ...current, [questionId]: true }));
    const oldObjectUrl = photoObjectUrls.current.get(questionId);
    if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);
    const objectUrl = URL.createObjectURL(file);
    photoObjectUrls.current.set(questionId, objectUrl);
    setPhotoPreviews((current) => ({ ...current, [questionId]: objectUrl }));
    void uploadPhoto(questionId, file);
  }, [clearPhotoPreview, uploadPhoto]);

  const removePhoto = useCallback(async (questionId: string) => {
    if (photoLocks.current.has(questionId)) return;
    photoFiles.current.delete(questionId);
    setRetryablePhotos((current) => ({ ...current, [questionId]: false }));
    clearPhotoPreview(questionId);
    setPhotoErrors((current) => ({ ...current, [questionId]: null }));

    if (!photoUrls[questionId]) {
      setPhotoStates((current) => ({ ...current, [questionId]: "removed" }));
      return;
    }

    photoLocks.current.add(questionId);
    setPhotoStates((current) => ({ ...current, [questionId]: "removing" }));
    const result = await removeReplyPhoto(
      token,
      questionId,
      copy.reply.errors.photoRemoveFailed,
    );
    photoLocks.current.delete(questionId);

    if (result.ok) {
      setPhotoUrls((current) => ({ ...current, [questionId]: null }));
      setPhotoStates((current) => ({ ...current, [questionId]: "removed" }));
    } else {
      setPhotoStates((current) => ({ ...current, [questionId]: "removeError" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: result.error }));
    }
  }, [clearPhotoPreview, photoUrls, token]);

  const retryPhoto = useCallback((questionId: string) => {
    if (photoStates[questionId] === "uploadError") {
      const file = photoFiles.current.get(questionId);
      if (file) void uploadPhoto(questionId, file);
    } else if (photoStates[questionId] === "removeError") {
      void removePhoto(questionId);
    }
  }, [photoStates, removePhoto, uploadPhoto]);

  const persist = useCallback(
    async (questionId: string, body: string) => {
      const revision = revisions.current.get(questionId) ?? 0;
      const nonEmpty = body.trim().length > 0;
      setQuestionStatuses((current) => ({ ...current, [questionId]: "saving" }));
      const result = await writeDraft(questionId, body);
      if ((revisions.current.get(questionId) ?? 0) !== revision) return;
      if (result.ok) {
        setQuestionStatuses((current) => ({ ...current, [questionId]: nonEmpty ? "saved" : "empty" }));
        setError(null);
      } else {
        setQuestionStatuses((current) => ({ ...current, [questionId]: "error" }));
        setError(result.error);
      }
    },
    [writeDraft],
  );

  const onChange = useCallback(
    (questionId: string, value: string, element: HTMLTextAreaElement) => {
      revisions.current.set(questionId, (revisions.current.get(questionId) ?? 0) + 1);
      setBodies((current) => ({ ...current, [questionId]: value }));
      setQuestionStatuses((current) => ({ ...current, [questionId]: "saving" }));
      autosize(element);

      const existing = timers.current.get(questionId);
      if (existing) clearTimeout(existing);
      timers.current.set(
        questionId,
        setTimeout(() => {
          timers.current.delete(questionId);
          void persist(questionId, value);
        }, 550),
      );
    },
    [autosize, persist],
  );

  const chooseMood = useCallback(async (emoji: string) => {
    setMood(emoji);
    setMoodStatus("saving");
    const result = await writeMood("round", emoji);
    setMoodStatus(result.ok ? "saved" : "error");
  }, [writeMood]);

  const onSend = useCallback(async () => {
    if (photoLocks.current.size > 0) return;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setSending(true);
    setSubmitFailed(false);
    setError(null);

    try {
      for (const question of questions) {
        const body = bodies[question.id] ?? "";
        const revision = (revisions.current.get(question.id) ?? 0) + 1;
        revisions.current.set(question.id, revision);
        setQuestionStatuses((current) => ({ ...current, [question.id]: "saving" }));
        const result = await writeDraft(question.id, body);
        if (!result.ok) {
          if ((revisions.current.get(question.id) ?? 0) === revision) {
            setQuestionStatuses((current) => ({ ...current, [question.id]: "error" }));
          }
          setSubmitFailed(true);
          setError(result.error);
          fields.current.get(question.id)?.focus();
          return;
        }
        if ((revisions.current.get(question.id) ?? 0) === revision) {
          setQuestionStatuses((current) => ({ ...current, [question.id]: body.trim() ? "saved" : "empty" }));
        }
      }

      const result = await postReply(token, { action: "submit" }, copy.reply.genericError);

      if (!result.ok) {
        setError(result.error);
        setSubmitFailed(true);
        return;
      }

      setSent(true);
      setAnimateSentStamp(true);
    } catch {
      setError(copy.reply.genericError);
      setSubmitFailed(true);
    } finally {
      setSending(false);
    }
  }, [bodies, questions, token, writeDraft]);

  return (
    <div className="theme-pack min-h-dvh" data-theme-pack={theme}>
      <header className="reply-topbar stitched sticky top-0 z-20 border-b bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[600px] items-center justify-between gap-3 px-4">
          <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
            <Cherries className="h-7 w-7 flex-none" /><span className="truncate">{loopName}</span>
          </span>
          <span className="chip flex h-7 items-center border bg-card px-3 text-[12px] font-bold text-ink-soft numeric">
            {text(copy.reply.answered, { answered, total })}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[600px] px-4 pb-36 pt-7">
        <div className="relative pr-16">
          <ThemeMark theme={theme} className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
          <p className="eyebrow">{text(copy.reply.hi, { name: displayName })}</p>
          <h1 className="mt-1 text-ink">{text(copy.reply.round, { number: roundNumber })}</h1>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {text(copy.reply.closes, { deadline: deadline.inLoopZone })}{" "}
          {deadline.inViewerZone ? text(copy.reply.viewerTimezone, { time: deadline.inViewerZone }) : ""}.
        </p>

        {sent ? (
          <div role="status" className="notice settle mt-6 flex items-start gap-3 border bg-accent-soft px-4 py-3">
            <svg viewBox="0 0 20 20" aria-hidden className={`sent-stamp mt-0.5 h-4 w-4 flex-none fill-accent${animateSentStamp ? " sent-stamp-animate" : ""}`}>
              <path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" />
            </svg>
            <p className="text-[14px] leading-relaxed text-ink">
              {text(copy.reply.sent, { deadline: deadline.inLoopZone })}
            </p>
          </div>
        ) : null}

        <section className="card mood-picker mt-6 p-5" aria-labelledby="mood-picker-title">
          <h2 id="mood-picker-title" className="text-ink">{copy.reply.moodTitle}</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{copy.reply.moodDescription}</p>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label={copy.reply.moodAriaLabel}>
            {copy.moods.options.map((option) => (
              <button
                key={option.emoji}
                type="button"
                aria-pressed={mood === option.emoji}
                aria-label={option.label}
                onClick={() => void chooseMood(mood === option.emoji ? "" : option.emoji)}
                disabled={sending}
                className={`mood-option ${mood === option.emoji ? "mood-option--selected" : ""}`}
              >
                <span aria-hidden="true" className="text-[22px]">{option.emoji}</span>
                <span className="text-[11px] font-bold leading-tight">{option.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex min-h-6 items-center justify-between gap-3">
            <p aria-live="polite" role={moodStatus === "error" ? "alert" : "status"} className={`text-[12px] ${moodStatus === "error" ? "text-danger" : "text-ink-muted"}`}>
              {moodStatus === "saving" ? copy.reply.moodSaving : null}
              {moodStatus === "saved" ? copy.reply.moodSaved : null}
              {moodStatus === "error" ? copy.reply.moodError : null}
            </p>
            {mood ? (
              <button type="button" className="min-h-11 text-[12px] font-bold text-ink-soft underline underline-offset-2" onClick={() => void chooseMood("")} disabled={sending}>
                {copy.reply.clearMood}
              </button>
            ) : null}
          </div>
        </section>

        <div className="mt-7 flex flex-col gap-6">
          {questions.map((question, index) => {
            const photoState = photoStates[question.id] ?? "idle";
            const photoUrl = photoUrls[question.id];
            const preview = photoPreviews[question.id];
            const writing = (
              <textarea
                ref={(element) => {
                  if (element) {
                    fields.current.set(question.id, element);
                    autosize(element);
                  }
                }}
                value={bodies[question.id] ?? ""}
                id={`reply-${question.id}`}
                onChange={(event) => onChange(question.id, event.target.value, event.currentTarget)}
                onFocus={(event) => autosize(event.currentTarget)}
                disabled={sending}
                rows={2}
                maxLength={8000}
                placeholder={copy.sections[question.kind].placeholder}
                aria-label={question.text}
                aria-describedby={`hint-${question.id}`}
                className={`field lined-field ${question.kind === "photo" ? "mt-4" : "mt-2"}`}
              />
            );
            const photo = (
              <PhotoAnswerControls
                questionId={question.id}
                photoUrl={photoUrl}
                preview={preview}
                photoState={photoState}
                photoError={photoErrors[question.id]}
                retryable={Boolean(retryablePhotos[question.id])}
                sending={sending}
                onSelect={(file) => selectPhoto(question.id, file)}
                onRemove={() => void removePhoto(question.id)}
                onRetry={() => retryPhoto(question.id)}
              />
            );

            return (
              <section key={question.id} data-kind={question.kind} className={`card paper ride-in reply-kind-${question.kind} block p-5 pt-7`}>
                <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
                <div className="mb-3 flex items-start justify-between gap-3">
                  <label htmlFor={`reply-${question.id}`} className="font-display text-[25px] font-bold leading-[1.15] text-ink">
                    {question.text}
                    <span className="section-kind-badge mt-1 block w-fit font-body">{copy.sections[question.kind].label}</span>
                  </label>
                  <span className="flex flex-none items-center gap-2 text-[12px] text-ink-muted" aria-live="polite">
                    {questionStatuses[question.id] === "saving" ? <span>{copy.reply.questionStates.saving}</span> : null}
                    {questionStatuses[question.id] === "saved" ? <span>{copy.reply.questionStates.saved}</span> : null}
                    {questionStatuses[question.id] === "error" ? <span>{copy.reply.questionStates.error}</span> : null}
                    {questionStatuses[question.id] === "error" ? (
                      <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => void persist(question.id, bodies[question.id] ?? "")}>
                        {copy.reply.retry}
                      </button>
                    ) : null}
                  </span>
                </div>
                <p id={`hint-${question.id}`} className="mb-2 text-[13px] leading-relaxed text-ink-soft">
                  {copy.sections[question.kind].replyHint}
                </p>
                {question.kind === "photo" ? <>{photo}{writing}</> : <>{writing}{photo}</>}
              </section>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[14px] leading-relaxed text-danger">
            {error}
          </p>
        ) : null}

        <p aria-live="polite" className="mt-4 h-5 text-[13px] text-ink-muted">
          {status === "saving" ? copy.reply.saving : null}
          {status === "saved" ? (sent ? copy.reply.saved : copy.reply.draftSaved) : null}
          {status === "error" ? copy.reply.notSaved : null}
        </p>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {text(copy.reply.privacy, { displayName, loopName })}
        </p>
      </main>

      <div
        className="reply-actionbar stitched-top fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-md"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-[600px] items-center justify-between gap-3 px-4 pt-3">
          <span className="text-[13px] font-medium text-ink-soft numeric">
            {sent ? copy.reply.sentState : text(copy.reply.answered, { answered, total })}
          </span>
          <button
            type="button"
            onClick={onSend}
            disabled={sending || photoBusy || (!sent && answered === 0)}
            className="btn btn-primary"
          >
            {sending ? copy.reply.sending : sent ? copy.reply.saveChanges : copy.reply.sendAnswers}
          </button>
        </div>
      </div>
    </div>
  );
}

function PhotoAnswerControls({
  questionId,
  photoUrl,
  preview,
  photoState,
  photoError,
  retryable,
  sending,
  onSelect,
  onRemove,
  onRetry,
}: {
  questionId: string;
  photoUrl: string | null | undefined;
  preview: string | null | undefined;
  photoState: PhotoStatus;
  photoError: string | null | undefined;
  retryable: boolean;
  sending: boolean;
  onSelect: (file: File) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const busy = photoState === "uploading" || photoState === "removing";
  const failed = photoState === "uploadError" || photoState === "removeError";
  const showRemove = Boolean(photoUrl || preview || failed);
  const statusText = photoState === "uploading"
    ? copy.reply.photoUploading
    : photoState === "removing"
      ? copy.reply.photoRemoving
      : photoState === "saved"
        ? copy.reply.photoSaved
        : photoState === "removed"
          ? copy.reply.photoRemoved
          : photoError;

  return (
    <div className="reply-photo-controls">
      {(preview || photoUrl) ? (
        <img
          src={preview ?? photoUrl ?? ""}
          alt={copy.reply.photoPreview}
          className="mt-4 max-h-[320px] w-full rounded-md border border-line object-cover"
        />
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          id={`photo-${questionId}`}
          type="file"
          accept={PHOTO_ACCEPT}
          className="peer sr-only"
          disabled={sending || busy}
          aria-label={photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto}
          aria-describedby={`photo-help-${questionId}`}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onSelect(file);
          }}
        />
        <label
          htmlFor={`photo-${questionId}`}
          className="btn btn-quiet min-h-11 px-4 text-[13px] peer-disabled:pointer-events-none peer-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
        >
          {photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto}
        </label>
        {showRemove ? (
          <button
            type="button"
            className="btn btn-quiet min-h-11 px-4 text-[13px]"
            onClick={onRemove}
            disabled={sending || busy}
          >
            {copy.reply.removePhoto}
          </button>
        ) : null}
        <span id={`photo-help-${questionId}`} className="text-[12px] leading-relaxed text-ink-muted">
          {copy.reply.photoFormats}
        </span>
      </div>
      {statusText ? (
        <p
          id={`photo-status-${questionId}`}
          role={failed ? "alert" : "status"}
          aria-live={failed ? "assertive" : "polite"}
          aria-atomic="true"
          className={`mt-2 text-[13px] leading-relaxed ${failed ? "text-danger" : "text-ink-muted"}`}
        >
          {statusText}
        </p>
      ) : null}
      {(photoState === "removeError" || (photoState === "uploadError" && retryable)) ? (
        <button
          type="button"
          className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2"
          onClick={onRetry}
          disabled={sending || busy}
        >
          {photoState === "removeError" ? copy.reply.retryPhotoRemove : copy.reply.retryPhotoUpload}
        </button>
      ) : null}
    </div>
  );
}

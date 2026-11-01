"use client";

/* eslint-disable @next/next/no-img-element -- Uploaded photos use local URLs in development and Blob URLs in production. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Deadline } from "@/lib/schedule";
import { Cherries, Tape } from "@/components/stationery";
import { copy, text } from "@/lib/copy";
import { formatTimeInZone } from "@/lib/format";
import { MAX_DISPLAY_NAME } from "@/lib/names";
import { MAX_PHOTO_BYTES, PHOTO_ACCEPT } from "@/lib/photo-validation";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  AUDIO_ACCEPT,
  formatAudioDuration,
} from "@/lib/audio-validation";
import {
  createSerialDraftWriter,
  postReply,
  removeReplyAudio,
  removeReplyPhoto,
  saveReplyName,
  uploadReplyAudio,
  uploadReplyPhoto,
} from "@/lib/reply-client";

export type SheetQuestion = {
  id: string;
  index: number;
  text: string;
  body: string;
  photoUrl: string | null;
  audioUrl: string | null;
  audioDurationMs: number | null;
  submitted: boolean;
};

type Props = {
  token: string;
  /** from_you loops have one writer who already owns the questions. */
  canSuggest: boolean;
  loopName: string;
  loopTimezone: string;
  roundNumber: number;
  deadline: Deadline;
  deliversAtIso: string;
  displayName: string;
  initialName: string | null;
  questions: SheetQuestion[];
};

type NameStatus = "idle" | "saving" | "saved" | "error";

function subscribeToNothing() {
  return () => {};
}

/**
 * The device's own clock, read the React way: no effect, no extra render, and
 * nothing on the server, so hydration can never disagree.
 */
function viewerTimeLabel(deliversAtIso: string, loopTimezone: string): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone || zone === loopTimezone) return null;
    return formatTimeInZone(new Date(deliversAtIso), zone);
  } catch {
    return null;
  }
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type QuestionSaveStatus = "empty" | "saving" | "saved" | "error";
type PhotoStatus = "idle" | "uploading" | "saved" | "removing" | "removed" | "uploadError" | "removeError";
type AudioStatus = "idle" | "recording" | "uploading" | "saved" | "removing" | "removed" | "uploadError" | "removeError";

export function ReplySheet({
  token,
  canSuggest,
  loopName,
  loopTimezone,
  roundNumber,
  deadline,
  deliversAtIso,
  displayName,
  initialName,
  questions,
}: Props) {
  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.body])),
  );
  const [name, setName] = useState(initialName ?? "");
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const viewerTime = useSyncExternalStore(
    subscribeToNothing,
    () => viewerTimeLabel(deliversAtIso, loopTimezone),
    () => null,
  );
  const [submitFailed, setSubmitFailed] = useState(false);
  const [questionStatuses, setQuestionStatuses] = useState<Record<string, QuestionSaveStatus>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.body.trim() ? "saved" : "empty"])),
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
  const [audioUrls, setAudioUrls] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.audioUrl])),
  );
  const [audioDurations, setAudioDurations] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.audioDurationMs])),
  );
  const [audioStates, setAudioStates] = useState<Record<string, AudioStatus>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, "idle"])),
  );
  const [audioErrors, setAudioErrors] = useState<Record<string, string | null>>({});
  const [retryableAudio, setRetryableAudio] = useState<Record<string, boolean>>({});
  const [audioPreviews, setAudioPreviews] = useState<Record<string, string | null>>({});
  const [recording, setRecording] = useState<{ questionId: string; startedAt: number } | null>(null);
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  // Server snapshot stays false so the sheet renders identically on the server;
  // recording affordances appear once the browser says it can.
  const canRecord = useSyncExternalStore(
    subscribeToNothing,
    () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    () => false,
  );
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
  const audioPending = useRef(new Map<string, { blob: Blob; filename: string; durationMs: number }>());
  const audioObjectUrls = useRef(new Map<string, string>());
  const audioLocks = useRef(new Set<string>());
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingChunks = useRef<Blob[]>([]);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const latestBodies = useRef<Record<string, string>>(
    Object.fromEntries(questions.map((question) => [question.id, question.body])),
  );
  const dirty = useRef(new Set<string>());
  const savedName = useRef(initialName ?? "");

  const total = questions.length;
  const writeDraft = useMemo(
    () => createSerialDraftWriter((questionId, body) => postReply(
      token,
      { action: "draft", issueQuestionId: questionId, body },
      copy.reply.genericError,
    )),
    [token],
  );
  const answered = useMemo(
    () => questions.filter((question) =>
      (bodies[question.id] ?? "").trim().length > 0 ||
      Boolean(photoUrls[question.id]) ||
      Boolean(audioUrls[question.id]),
    ).length,
    [audioUrls, bodies, photoUrls, questions],
  );
  const audioBusy = useMemo(
    () => Object.values(audioStates).some((state) => state === "uploading" || state === "removing"),
    [audioStates],
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

  /**
   * The last 550ms of typing used to die with the tab. On the way out, send every
   * dirty answer once more with a beacon, which the browser delivers even as the
   * page is torn down.
   */
  const flushDrafts = useCallback(() => {
    if (dirty.current.size === 0) return;
    for (const [questionId, timer] of timers.current) {
      clearTimeout(timer);
      timers.current.delete(questionId);
    }
    for (const questionId of dirty.current) {
      const body = latestBodies.current[questionId] ?? "";
      const payload = JSON.stringify({ action: "draft", issueQuestionId: questionId, body });
      const beaconQueued = navigator.sendBeacon?.(
        `/api/reply/${token}`,
        new Blob([payload], { type: "application/json" }),
      );
      if (!beaconQueued) {
        void fetch(`/api/reply/${token}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => undefined);
      }
    }
    dirty.current.clear();
  }, [token]);

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") flushDrafts();
    };
    window.addEventListener("pagehide", flushDrafts);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushDrafts);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [flushDrafts]);

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

  const clearAudioPreview = useCallback((questionId: string) => {
    const objectUrl = audioObjectUrls.current.get(questionId);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    audioObjectUrls.current.delete(questionId);
    setAudioPreviews((current) => ({ ...current, [questionId]: null }));
  }, []);

  const uploadAudio = useCallback(async (questionId: string, blob: Blob, filename: string, durationMs: number) => {
    if (audioLocks.current.has(questionId)) return;
    audioLocks.current.add(questionId);
    setAudioStates((current) => ({ ...current, [questionId]: "uploading" }));
    setAudioErrors((current) => ({ ...current, [questionId]: null }));

    const result = await uploadReplyAudio(token, questionId, blob, filename, durationMs, copy.reply.errors.audioSaveFailed);
    audioLocks.current.delete(questionId);

    if (result.ok) {
      setAudioUrls((current) => ({ ...current, [questionId]: result.audioUrl }));
      setAudioDurations((current) => ({ ...current, [questionId]: result.audioDurationMs }));
      audioPending.current.delete(questionId);
      setRetryableAudio((current) => ({ ...current, [questionId]: false }));
      setAudioStates((current) => ({ ...current, [questionId]: "saved" }));
      setAudioErrors((current) => ({ ...current, [questionId]: null }));
    } else {
      audioPending.current.set(questionId, { blob, filename, durationMs });
      setRetryableAudio((current) => ({ ...current, [questionId]: true }));
      setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: result.error }));
    }
    clearAudioPreview(questionId);
  }, [clearAudioPreview, token]);

  const stopRecording = useCallback((questionId: string, discard: boolean) => {
    const active = recorder.current;
    if (!active || active.state === "inactive") {
      setRecording(null);
      setRecordingElapsed(0);
      return;
    }
    const startedAt = recording?.startedAt ?? Date.now();
    active.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const type = active.mimeType || "audio/webm";
      const blob = new Blob(recordingChunks.current, { type });
      recordingChunks.current = [];
      for (const track of active.stream.getTracks()) track.stop();
      recorder.current = null;
      if (recordingTimer.current) {
        clearInterval(recordingTimer.current);
        recordingTimer.current = null;
      }
      setRecording(null);
      setRecordingElapsed(0);

      if (discard || durationMs > MAX_AUDIO_DURATION_MS) {
        setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
        setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.voiceTooLong }));
        return;
      }
      const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      void uploadAudio(questionId, blob, `voice-note.${extension}`, durationMs);
    };
    active.stop();
  }, [recording, uploadAudio]);

  const startRecording = useCallback(async (questionId: string) => {
    if (recording || audioLocks.current.has(questionId)) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
      ].find((candidate) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate));
      const active = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recordingChunks.current = [];
      active.ondataavailable = (event) => {
        if (event.data.size > 0) recordingChunks.current.push(event.data);
      };
      const startedAt = Date.now();
      active.start(250);
      recorder.current = active;
      setRecording({ questionId, startedAt });
      setAudioStates((current) => ({ ...current, [questionId]: "recording" }));
      setAudioErrors((current) => ({ ...current, [questionId]: null }));
      recordingTimer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= MAX_AUDIO_DURATION_MS) {
          // The hard stop: over three minutes discards the take with a warm error.
          stopRecording(questionId, true);
          return;
        }
        setRecordingElapsed(elapsed);
      }, 200);
    } catch {
      setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.voiceNoRecorder }));
    }
  }, [recording, stopRecording]);

  const pickAudioFile = useCallback((questionId: string, file: File) => {
    if (audioLocks.current.has(questionId)) return;
    if (file.size > MAX_AUDIO_BYTES) {
      setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.voiceTooLarge }));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const probe = new Audio();
    probe.preload = "metadata";
    const cleanup = () => URL.revokeObjectURL(objectUrl);
    probe.onloadedmetadata = () => {
      cleanup();
      const durationMs = Number.isFinite(probe.duration) ? probe.duration * 1000 : NaN;
      if (!Number.isFinite(durationMs) || durationMs > MAX_AUDIO_DURATION_MS) {
        setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
        setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.voiceTooLong }));
        return;
      }
      const oldObjectUrl = audioObjectUrls.current.get(questionId);
      if (oldObjectUrl) URL.revokeObjectURL(oldObjectUrl);
      audioObjectUrls.current.set(questionId, objectUrl);
      setAudioPreviews((current) => ({ ...current, [questionId]: objectUrl }));
      void uploadAudio(questionId, file, file.name, durationMs);
    };
    probe.onerror = () => {
      cleanup();
      setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.errors.invalidAudio }));
    };
    probe.src = objectUrl;
  }, [uploadAudio]);

  const removeAudio = useCallback(async (questionId: string) => {
    if (audioLocks.current.has(questionId)) return;
    audioPending.current.delete(questionId);
    setRetryableAudio((current) => ({ ...current, [questionId]: false }));
    clearAudioPreview(questionId);
    setAudioErrors((current) => ({ ...current, [questionId]: null }));

    if (!audioUrls[questionId]) {
      setAudioStates((current) => ({ ...current, [questionId]: "removed" }));
      return;
    }

    audioLocks.current.add(questionId);
    setAudioStates((current) => ({ ...current, [questionId]: "removing" }));
    const result = await removeReplyAudio(token, questionId, copy.reply.errors.audioRemoveFailed);
    audioLocks.current.delete(questionId);

    if (result.ok) {
      setAudioUrls((current) => ({ ...current, [questionId]: null }));
      setAudioDurations((current) => ({ ...current, [questionId]: null }));
      setAudioStates((current) => ({ ...current, [questionId]: "removed" }));
    } else {
      setAudioStates((current) => ({ ...current, [questionId]: "removeError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: result.error }));
    }
  }, [audioUrls, clearAudioPreview, token]);

  const retryAudio = useCallback((questionId: string) => {
    if (audioStates[questionId] === "uploadError") {
      const pending = audioPending.current.get(questionId);
      if (pending) void uploadAudio(questionId, pending.blob, pending.filename, pending.durationMs);
    } else if (audioStates[questionId] === "removeError") {
      void removeAudio(questionId);
    }
  }, [audioStates, removeAudio, uploadAudio]);

  useEffect(() => () => {
    if (recordingTimer.current) clearInterval(recordingTimer.current);
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    for (const objectUrl of audioObjectUrls.current.values()) URL.revokeObjectURL(objectUrl);
    audioObjectUrls.current.clear();
  }, []);

  const persist = useCallback(
    async (questionId: string, body: string) => {
      const revision = revisions.current.get(questionId) ?? 0;
      const nonEmpty = body.trim().length > 0;
      setQuestionStatuses((current) => ({ ...current, [questionId]: "saving" }));
      const result = await writeDraft(questionId, body);
      if ((revisions.current.get(questionId) ?? 0) !== revision) return;
      if (result.ok) {
        setQuestionStatuses((current) => ({ ...current, [questionId]: nonEmpty ? "saved" : "empty" }));
        dirty.current.delete(questionId);
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
      dirty.current.add(questionId);
      latestBodies.current[questionId] = value;
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

  const saveDisplayName = useCallback(async () => {
    const trimmed = name.trim().slice(0, MAX_DISPLAY_NAME).trim();
    if (!trimmed || trimmed === savedName.current) {
      if (!trimmed) setNameStatus("idle");
      return;
    }
    setNameStatus("saving");
    const result = await saveReplyName(token, trimmed, copy.reply.nameError);
    if (result.ok) {
      savedName.current = trimmed;
      setNameStatus("saved");
    } else {
      setNameStatus("error");
    }
  }, [name, token]);

  const onSend = useCallback(async () => {
    if (photoLocks.current.size > 0) return;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setSending(true);
    setSubmitFailed(false);
    setError(null);

    // A name is a nicety; never let it block the answers themselves.
    const trimmedName = name.trim().slice(0, MAX_DISPLAY_NAME).trim();
    if (trimmedName && trimmedName !== savedName.current) {
      const nameResult = await saveReplyName(token, trimmedName, copy.reply.nameError);
      if (nameResult.ok) {
        savedName.current = trimmedName;
        setNameStatus("saved");
      }
    }

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
  }, [bodies, name, questions, token, writeDraft]);

  return (
    <>
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
          <Cherries className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
          <p className="eyebrow">{text(copy.reply.hi, { name: name.trim() || displayName })}</p>
          <h1 className="mt-1 text-ink">{text(copy.reply.round, { number: roundNumber })}</h1>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          {text(copy.reply.closes, { deadline: deadline.inLoopZone })}
          {viewerTime ? ` ${text(copy.reply.viewerTimezone, { time: viewerTime })}` : null}.
        </p>

        <section className="card mt-5 p-4">
          <label htmlFor="reply-name" className="block text-[13px] font-medium text-ink-soft">
            {copy.reply.nameTitle}
          </label>
          <input
            id="reply-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (nameStatus !== "saving") setNameStatus("idle");
            }}
            onBlur={() => void saveDisplayName()}
            maxLength={MAX_DISPLAY_NAME}
            autoComplete="given-name"
            placeholder={copy.reply.namePlaceholder}
            disabled={sending}
            className="field mt-1.5 h-11 py-0"
          />
          <p
            aria-live="polite"
            className={`mt-1 text-[12px] leading-relaxed ${nameStatus === "error" ? "text-danger" : "text-ink-muted"}`}
          >
            {nameStatus === "saving"
              ? copy.reply.nameSaving
              : nameStatus === "saved"
                ? copy.reply.nameSaved
                : nameStatus === "error"
                  ? copy.reply.nameError
                  : copy.reply.nameHint}
          </p>
        </section>

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

        <div className="mt-7 flex flex-col gap-6">
          {questions.map((question, index) => {
            const photoState = photoStates[question.id] ?? "idle";
            const photoUrl = photoUrls[question.id];
            const preview = photoPreviews[question.id];
            const photoBusyForCard = photoState === "uploading" || photoState === "removing";
            const showRemove = Boolean(photoUrl || preview || photoState === "uploadError" || photoState === "removeError");
            const photoStatusText = photoState === "uploading"
              ? copy.reply.photoUploading
              : photoState === "removing"
                ? copy.reply.photoRemoving
                : photoState === "saved"
                  ? copy.reply.photoSaved
                  : photoState === "removed"
                    ? copy.reply.photoRemoved
                    : photoErrors[question.id];
            const audioState = audioStates[question.id] ?? "idle";
            const audioUrl = audioUrls[question.id];
            const audioPreview = audioPreviews[question.id];
            const voiceBusyForCard = audioState === "uploading" || audioState === "removing";
            const showVoiceRemove = Boolean(
              audioUrl ||
                audioPreview ||
                (audioState === "uploadError" && retryableAudio[question.id]) ||
                audioState === "removeError",
            );
            const audioStatusText = audioState === "uploading"
              ? copy.reply.voiceUploading
              : audioState === "removing"
                ? copy.reply.voiceRemoving
                : audioState === "saved"
                  ? copy.reply.voiceSaved
                  : audioState === "removed"
                    ? copy.reply.voiceRemoved
                    : audioErrors[question.id];

            return (
            <>
            <section key={question.id} className="card paper ride-in block p-5 pt-7">
              <Tape tone={(["dots", "stripe", "mint", "check"] as const)[index % 4]} position={index % 2 ? "right" : "left"} />
              <div className="mb-3 flex items-start justify-between gap-3">
                <label htmlFor={`reply-${question.id}`} className="font-display text-[25px] font-bold leading-[1.15] text-ink">
                  {question.text}
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
                placeholder={copy.reply.placeholder}
                aria-label={question.text}
                className="field lined-field mt-2"
              />

              {(preview || photoUrl) ? (
                <img
                  src={preview ?? photoUrl ?? ""}
                  alt={copy.reply.photoPreview}
                  className="mt-4 max-h-[320px] w-full rounded-md border border-line object-cover"
                />
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  id={`photo-${question.id}`}
                  type="file"
                  accept={PHOTO_ACCEPT}
                  className="peer sr-only"
                  disabled={sending || photoBusyForCard}
                  aria-label={photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto}
                  aria-describedby={`photo-help-${question.id}`}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) selectPhoto(question.id, file);
                  }}
                />
                <label
                  htmlFor={`photo-${question.id}`}
                  className="btn btn-quiet min-h-11 px-4 text-[13px] peer-disabled:pointer-events-none peer-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
                >
                  {photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto}
                </label>
                {showRemove ? (
                  <button
                    type="button"
                    className="btn btn-quiet min-h-11 px-4 text-[13px]"
                    onClick={() => void removePhoto(question.id)}
                    disabled={sending || photoBusyForCard}
                  >
                    {copy.reply.removePhoto}
                  </button>
                ) : null}
                <span id={`photo-help-${question.id}`} className="text-[12px] leading-relaxed text-ink-muted">
                  {copy.reply.photoFormats}
                </span>
              </div>
              {photoStatusText ? (
                <p
                  id={`photo-status-${question.id}`}
                  role={photoState === "uploadError" || photoState === "removeError" ? "alert" : "status"}
                  aria-live={photoState === "uploadError" || photoState === "removeError" ? "assertive" : "polite"}
                  aria-atomic="true"
                  className={`mt-2 text-[13px] leading-relaxed ${photoState === "uploadError" || photoState === "removeError" ? "text-danger" : "text-ink-muted"}`}
                >
                  {photoStatusText}
                </p>
              ) : null}
              {(photoState === "removeError" || (photoState === "uploadError" && retryablePhotos[question.id])) ? (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2"
                  onClick={() => retryPhoto(question.id)}
                  disabled={sending || photoBusyForCard}
                >
                  {photoState === "removeError" ? copy.reply.retryPhotoRemove : copy.reply.retryPhotoUpload}
                </button>
              ) : null}
            </section>

            <section aria-label={copy.reply.voiceRecord} className="mt-4 border-t border-line pt-4">
              {recording?.questionId === question.id ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13px] font-medium text-ink numeric" role="status">
                    {text(copy.reply.voiceRecording, { elapsed: formatAudioDuration(recordingElapsed) })}
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary min-h-11 px-4 text-[13px]"
                    onClick={() => stopRecording(question.id, false)}
                  >
                    {copy.reply.voiceStop}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  {canRecord ? (
                    <button
                      type="button"
                      className="btn btn-quiet min-h-11 px-4 text-[13px]"
                      onClick={() => void startRecording(question.id)}
                      disabled={sending || voiceBusyForCard || Boolean(recording)}
                    >
                      {audioUrl ? copy.reply.voiceReplace : copy.reply.voiceRecord}
                    </button>
                  ) : null}
                  <input
                    id={`audio-${question.id}`}
                    type="file"
                    accept={AUDIO_ACCEPT}
                    className="peer sr-only"
                    disabled={sending || voiceBusyForCard || Boolean(recording)}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) pickAudioFile(question.id, file);
                      event.target.value = "";
                    }}
                  />
                  <label
                    htmlFor={`audio-${question.id}`}
                    className="btn btn-quiet min-h-11 px-4 text-[13px] peer-disabled:pointer-events-none peer-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-2"
                  >
                    {copy.reply.voicePick}
                  </label>
                  {showVoiceRemove ? (
                    <button
                      type="button"
                      className="btn btn-quiet min-h-11 px-4 text-[13px]"
                      onClick={() => void removeAudio(question.id)}
                      disabled={sending || voiceBusyForCard}
                    >
                      {copy.reply.voiceRemove}
                    </button>
                  ) : null}
                  {!canRecord && !audioUrl ? (
                    <span className="text-[12px] leading-relaxed text-ink-muted">{copy.reply.voiceNoRecorder}</span>
                  ) : null}
                </div>
              )}
              {(audioPreview || audioUrl) ? (
                <audio
                  controls
                  preload="none"
                  src={audioPreview ?? audioUrl ?? ""}
                  aria-label={text(copy.reply.voiceDurationLabel, { duration: formatAudioDuration(audioDurations[question.id] ?? 0) })}
                  className="mt-2 w-full"
                />
              ) : null}
              {audioStatusText ? (
                <p
                  id={`audio-status-${question.id}`}
                  role={audioState === "uploadError" || audioState === "removeError" ? "alert" : "status"}
                  aria-live={audioState === "uploadError" || audioState === "removeError" ? "assertive" : "polite"}
                  aria-atomic="true"
                  className={`mt-2 text-[13px] leading-relaxed ${audioState === "uploadError" || audioState === "removeError" ? "text-danger" : "text-ink-muted"}`}
                >
                  {audioStatusText}
                </p>
              ) : null}
              {(audioState === "removeError" || (audioState === "uploadError" && retryableAudio[question.id] && !recording)) ? (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2"
                  onClick={() => retryAudio(question.id)}
                  disabled={sending || voiceBusyForCard}
                >
                  {audioState === "removeError" ? copy.reply.voiceRetryRemove : copy.reply.voiceRetryUpload}
                </button>
              ) : null}
              <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{copy.reply.voiceFormats}</p>
            </section>
            </>
            );
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-[14px] leading-relaxed text-danger">
            {error}
          </p>
        ) : null}

        <p aria-live="polite" data-save-status className="mt-4 h-5 text-[13px] text-ink-muted">
          {status === "saving" ? copy.reply.saving : null}
          {status === "saved" ? (sent ? copy.reply.saved : copy.reply.draftSaved) : null}
          {status === "error" ? copy.reply.notSaved : null}
        </p>

        <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
          {text(copy.reply.privacy, { displayName: name.trim() || displayName, loopName })}
        </p>

        {canSuggest ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-muted">
            <Link
              href={`/r/${token}/suggest`}
              className="font-medium text-ink underline decoration-line-strong underline-offset-4"
            >
              {copy.reply.suggestLink}
            </Link>
          </p>
        ) : null}
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
            disabled={sending || photoBusy || audioBusy || (!sent && answered === 0)}
            className="btn btn-primary"
          >
            {sending ? copy.reply.sending : sent ? copy.reply.saveChanges : copy.reply.sendAnswers}
          </button>
        </div>
      </div>
    </>
  );
}

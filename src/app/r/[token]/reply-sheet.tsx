"use client";

/* eslint-disable @next/next/no-img-element -- Uploaded photos use local URLs in development and Blob URLs in production. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Deadline } from "@/lib/schedule";
import { LoopBanner } from "@/components/loop-theme";
import { ProfilePhoto } from "@/components/profile-photo";
import { ReminderPreference } from "@/components/reminder-preference";
import { MutedNotice } from "@/components/muted-notice";
import type { ReminderPreference as ReminderPreferenceValue } from "@/lib/reminders";
import { Cherries, Tape } from "@/components/stationery";
import { issueTitle } from "@/lib/issue-name";
import { copy, text } from "@/lib/copy";
import { formatTimeInZone } from "@/lib/format";
import { MAX_DISPLAY_NAME } from "@/lib/names";
import { PHOTO_ACCEPT } from "@/lib/photo-validation";
import { PHOTO_TARGET, prepareImage } from "@/components/prepare-image";
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
import { removeReplySectionMedia, uploadReplySectionPhoto } from "@/lib/section-client";
import type { SheetSection } from "@/lib/sections";
import { PollCard, type PollCardStatus } from "./poll-card";

export type SheetQuestion = {
  id: string;
  index: number;
  text: string;
  body: string;
  photoUrl: string | null;
  audioUrl: string | null;
  audioDurationMs: number | null;
  kind: "written" | "poll";
  pollMultiple: boolean;
  pollOptions: string[];
  pollChoices: number[];
  submitted: boolean;
};

type Props = {
  token: string;
  /** from_you loops have one writer who already owns the questions. */
  canSuggest: boolean;
  sections: SheetSection[];
  loopName: string;
  loopTimezone: string;
  roundNumber: number;
  roundName: string | null;
  headerImageUrl: string | null;
  photoUrl: string | null;
  deadline: Deadline;
  deliversAtIso: string;
  displayName: string;
  initialName: string | null;
  reminderPreference: ReminderPreferenceValue;
  /** Set when this member turned off the loop's emails: offers the way back. */
  mutedUnsubscribeToken?: string | null;
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
  sections,
  loopName,
  loopTimezone,
  roundNumber,
  roundName,
  headerImageUrl,
  photoUrl,
  deadline,
  deliversAtIso,
  displayName,
  initialName,
  reminderPreference,
  mutedUnsubscribeToken,
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
  // True from Stop until the recorder has finished: nothing may start or stop meanwhile.
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  // Ids to try, in order, once the next render lands: where focus goes when its control unmounts.
  const pendingFocus = useRef<string[] | null>(null);
  // Server snapshot stays false so the sheet renders identically on the server;
  // recording affordances appear once the browser says it can.
  const canRecord = useSyncExternalStore(
    subscribeToNothing,
    () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    () => false,
  );
  // A page served over plain http (a phone reaching a dev machine by its address, say) has no
  // microphone API at all and the browser never asks, which looks like "can't record".
  const secureContext = useSyncExternalStore(
    subscribeToNothing,
    () => window.isSecureContext,
    () => true,
  );
  const [pollPicks, setPollPicks] = useState<Record<string, number[]>>(() =>
    Object.fromEntries(questions.map((question) => [question.id, question.pollChoices])),
  );
  const [pollStatuses, setPollStatuses] = useState<Record<string, PollCardStatus>>({});
  const pollRevisions = useRef(new Map<string, number>());
  const [sent, setSent] = useState(() => questions.some((question) => question.submitted));
  const [animateSentStamp, setAnimateSentStamp] = useState(false);
  // After a send, the sheet steps aside for a confirmation; "Edit my answers" brings it back.
  // The sheet stays mounted (only hidden) so nothing in it — drafts, photos, previews — is lost.
  const [confirmation, setConfirmation] = useState<null | "sent" | "updated">(null);
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const sheetHeading = useRef<HTMLHeadingElement>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One permanent polite region for things that have no visible text of their own.
  const [announcement, setAnnouncement] = useState("");

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
  const recordingStarting = useRef(false);
  const latestBodies = useRef<Record<string, string>>(
    Object.fromEntries(questions.map((question) => [question.id, question.body])),
  );
  const dirty = useRef(new Set<string>());
  const savedName = useRef(initialName ?? "");

  const [sectionBodies, setSectionBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, section.body])),
  );
  const [sectionLinks, setSectionLinks] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, section.linkUrl])),
  );
  const [sectionCaptions, setSectionCaptions] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, section.body])),
  );
  const [sectionMediaLists, setSectionMediaLists] = useState(() =>
    Object.fromEntries(sections.map((section) => [section.id, section.media])),
  );
  const [sectionSaveStates, setSectionSaveStates] = useState<Record<string, "idle" | "saving" | "saved" | "error">>(() =>
    Object.fromEntries(sections.map((section) => [section.id, "idle" as const])),
  );
  const [sectionErrors, setSectionErrors] = useState<Record<string, string | null>>({});
  const [sectionNotices, setSectionNotices] = useState<Record<string, string | null>>({});
  const sectionUploadLocks = useRef(new Set<string>());
  // Sections with a photo being shrunk or uploaded right now: Send waits for them.
  const [sectionUploading, setSectionUploading] = useState<Record<string, boolean>>({});

  const total = questions.length;
  const writeDraft = useMemo(
    () => createSerialDraftWriter((questionId, body) => postReply(
      token,
      { action: "draft", issueQuestionId: questionId, body },
      copy.reply.genericError,
    )),
    [token],
  );
  const writePoll = useMemo(
    () => createSerialDraftWriter((questionId, encoded) => postReply(
      token,
      { action: "pollChoice", issueQuestionId: questionId, choices: JSON.parse(encoded) as number[] },
      copy.polls.errors.saveFailed,
    )),
    [token],
  );
  const writeSectionDraft = useMemo(
    () => createSerialDraftWriter((issueSectionId, body) => postReply(
      token,
      { action: "sectionDraft", issueSectionId, body },
      copy.reply.errors.sectionSaveFailed,
    )),
    [token],
  );
  const answered = useMemo(
    () => questions.filter((question) =>
      question.kind === "poll"
        ? (pollPicks[question.id] ?? []).length > 0
        : (bodies[question.id] ?? "").trim().length > 0 ||
          Boolean(photoUrls[question.id]) ||
          Boolean(audioUrls[question.id]),
    ).length,
    [audioUrls, bodies, photoUrls, pollPicks, questions],
  );
  // Section answers count toward the action bar, so a section-only round sends.
  const sectionAnswered = useMemo(
    () => sections.some((section) =>
      (sectionBodies[section.id] ?? "").trim().length > 0 ||
      (sectionLinks[section.id] ?? "").trim().length > 0 ||
      (sectionMediaLists[section.id] ?? []).length > 0,
    ),
    [sectionBodies, sectionLinks, sectionMediaLists, sections],
  );
  const audioBusy = useMemo(
    () => Object.values(audioStates).some((state) => state === "uploading" || state === "removing"),
    [audioStates],
  );
  // A pick still on its way would miss the send, so the button waits for it.
  const pollBusy = useMemo(
    () => Object.values(pollStatuses).some((state) => state === "saving"),
    [pollStatuses],
  );
  const photoBusy = useMemo(
    () =>
      Object.values(photoStates).some((state) => state === "uploading" || state === "removing") ||
      Object.values(sectionUploading).some(Boolean),
    [photoStates, sectionUploading],
  );
  const sendBlocked = sending || photoBusy || audioBusy || pollBusy;
  // Nothing written yet: Send stays operable and points at the first question instead.
  // The name is not an answer.
  const nothingToSend = !sent && answered === 0 && !sectionAnswered;
  const [nudged, setNudged] = useState(false);
  // Once something is written the note has done its job; clearing it again doesn't bring it back.
  if (nudged && !nothingToSend) setNudged(false);
  const showNudge = nudged && nothingToSend;
  const questionList = useRef<HTMLDivElement>(null);
  const sectionList = useRef<HTMLElement>(null);
  const nudgeMessage = useRef<HTMLParagraphElement>(null);
  // The deadline in the loop's zone, and the reader's own when it differs.
  const deadlineBoth = viewerTime
    ? `${deadline.inLoopZone} ${text(copy.reply.viewerTimezone, { time: viewerTime })}`
    : deadline.inLoopZone;
  const status: SaveStatus = useMemo(() => {
    const states = Object.values(questionStatuses);
    if (submitFailed || states.includes("error")) return "error";
    if (states.includes("saving")) return "saving";
    if (states.includes("saved")) return "saved";
    return "idle";
  }, [questionStatuses, submitFailed]);

  // A control that unmounts takes keyboard focus with it, so the handler names its successor.
  useEffect(() => {
    const ids = pendingFocus.current;
    if (!ids) return;
    pendingFocus.current = null;
    for (const id of ids) {
      const target = document.getElementById(id);
      if (target) {
        target.focus();
        return;
      }
    }
  });

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

  const selectPhoto = useCallback(async (questionId: string, picked: File) => {
    if (photoLocks.current.has(questionId)) return;
    // Camera-roll photos are shrunk here, so a 9 MB picture is no different to send than a 2 MB one.
    setPhotoStates((current) => ({ ...current, [questionId]: "uploading" }));
    setPhotoErrors((current) => ({ ...current, [questionId]: null }));
    const prepared = await prepareImage(picked, PHOTO_TARGET);

    if (!prepared.ok) {
      photoFiles.current.delete(questionId);
      setRetryablePhotos((current) => ({ ...current, [questionId]: false }));
      clearPhotoPreview(questionId);
      setPhotoStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: copy.reply.errors.photoUnreadable }));
      return;
    }

    const file = prepared.file;
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
      pendingFocus.current = [`photo-${questionId}`];
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
      pendingFocus.current = [`photo-${questionId}`];
      setPhotoUrls((current) => ({ ...current, [questionId]: null }));
      setPhotoStates((current) => ({ ...current, [questionId]: "removed" }));
    } else {
      setPhotoStates((current) => ({ ...current, [questionId]: "removeError" }));
      setPhotoErrors((current) => ({ ...current, [questionId]: result.error }));
    }
  }, [clearPhotoPreview, photoUrls, token]);

  const retryPhoto = useCallback((questionId: string) => {
    pendingFocus.current = [`photo-${questionId}`];
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
    // A second Stop while the first is still finishing must change nothing.
    if (stoppingRef.current) return;
    const active = recorder.current;
    if (!active || active.state === "inactive") {
      setRecording(null);
      setRecordingElapsed(0);
      return;
    }
    const startedAt = recording?.startedAt ?? Date.now();
    stoppingRef.current = true;
    setStopping(true);
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
      stoppingRef.current = false;
      setStopping(false);

      if (discard || durationMs > MAX_AUDIO_DURATION_MS) {
        setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
        setAudioErrors((current) => ({ ...current, [questionId]: copy.reply.voiceTooLong }));
        return;
      }
      setAnnouncement(copy.a11yStatus.recordingStopped);
      const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      void uploadAudio(questionId, blob, `voice-note.${extension}`, durationMs);
    };
    active.stop();
  }, [recording, uploadAudio]);

  const startRecording = useCallback(async (questionId: string) => {
    // A second tap while the permission prompt is up would open a second stream.
    if (recording || stoppingRef.current || recordingStarting.current || audioLocks.current.has(questionId)) return;
    recordingStarting.current = true;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      setAnnouncement(copy.a11yStatus.recordingStarted);
      let warned = false;
      setAudioStates((current) => ({ ...current, [questionId]: "recording" }));
      setAudioErrors((current) => ({ ...current, [questionId]: null }));
      recordingTimer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (elapsed >= MAX_AUDIO_DURATION_MS) {
          // The hard stop: over three minutes discards the take with a warm error.
          stopRecording(questionId, true);
          return;
        }
        if (!warned && elapsed >= MAX_AUDIO_DURATION_MS - 30_000) {
          warned = true;
          setAnnouncement(copy.a11yStatus.recordingNearLimit);
        }
        setRecordingElapsed(elapsed);
      }, 200);
    } catch (error) {
      // If the microphone opened but the recorder couldn't start, let it go again,
      // or the phone keeps showing the microphone in use.
      stream?.getTracks().forEach((track) => track.stop());
      // Say what actually went wrong: a refused permission and a missing
      // microphone call for different things from the person.
      const name = error instanceof DOMException ? error.name : "";
      console.warn("Voice recording could not start", name || error);
      const message = name === "NotAllowedError" || name === "SecurityError"
        ? copy.reply.voiceBlocked
        : name === "NotFoundError" || name === "OverconstrainedError"
          ? copy.reply.voiceNoMic
          : name === "NotReadableError" || name === "AbortError"
            ? copy.reply.voiceMicBusy
            : copy.reply.voiceNoRecorder;
      setAudioStates((current) => ({ ...current, [questionId]: "uploadError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: message }));
    } finally {
      recordingStarting.current = false;
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
      pendingFocus.current = [`record-${questionId}`, `audio-${questionId}`];
      setAudioStates((current) => ({ ...current, [questionId]: "removed" }));
      return;
    }

    audioLocks.current.add(questionId);
    setAudioStates((current) => ({ ...current, [questionId]: "removing" }));
    const result = await removeReplyAudio(token, questionId, copy.reply.errors.audioRemoveFailed);
    audioLocks.current.delete(questionId);

    if (result.ok) {
      pendingFocus.current = [`record-${questionId}`, `audio-${questionId}`];
      setAudioUrls((current) => ({ ...current, [questionId]: null }));
      setAudioDurations((current) => ({ ...current, [questionId]: null }));
      setAudioStates((current) => ({ ...current, [questionId]: "removed" }));
    } else {
      setAudioStates((current) => ({ ...current, [questionId]: "removeError" }));
      setAudioErrors((current) => ({ ...current, [questionId]: result.error }));
    }
  }, [audioUrls, clearAudioPreview, token]);

  const retryAudio = useCallback((questionId: string) => {
    pendingFocus.current = [`record-${questionId}`, `audio-${questionId}`];
    if (audioStates[questionId] === "uploadError") {
      const pending = audioPending.current.get(questionId);
      if (pending) void uploadAudio(questionId, pending.blob, pending.filename, pending.durationMs);
    } else if (audioStates[questionId] === "removeError") {
      void removeAudio(questionId);
    }
  }, [audioStates, removeAudio, uploadAudio]);

  const saveSection = useCallback(async (issueSectionId: string, urlOverride?: string) => {
    setSectionSaveStates((current) => ({ ...current, [issueSectionId]: "saving" }));
    // Clear first, so the same failure twice is announced twice.
    setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    const url = urlOverride ?? sectionLinks[issueSectionId] ?? "";
    const caption = sectionCaptions[issueSectionId] ?? "";
    const result = await postReply(
      token,
      { action: "sectionMusic", issueSectionId, url, caption },
      copy.reply.errors.sectionSaveFailed,
    );
    if (result.ok) {
      setSectionSaveStates((current) => ({ ...current, [issueSectionId]: "saved" }));
      setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    } else {
      setSectionSaveStates((current) => ({ ...current, [issueSectionId]: "error" }));
      setSectionErrors((current) => ({ ...current, [issueSectionId]: result.error }));
    }
  }, [sectionCaptions, sectionLinks, token]);

  const saveSectionText = useCallback((issueSectionId: string) => {
    setSectionSaveStates((current) => ({ ...current, [issueSectionId]: "saving" }));
    setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    void writeSectionDraft(issueSectionId, sectionBodies[issueSectionId] ?? "")
      .then((result) => {
        setSectionSaveStates((current) => ({ ...current, [issueSectionId]: result.ok ? "saved" : "error" }));
        if (!result.ok) setSectionErrors((current) => ({ ...current, [issueSectionId]: result.error }));
      });
  }, [sectionBodies, writeSectionDraft]);

  const uploadSectionPhoto = useCallback(async (issueSectionId: string, kind: SheetSection["kind"], picked: File, caption: string, position: number) => {
    const lockKey = `${issueSectionId}:${position}`;
    if (sectionUploadLocks.current.has(lockKey)) return;
    sectionUploadLocks.current.add(lockKey);
    setSectionUploading((current) => ({ ...current, [issueSectionId]: true }));
    setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    setSectionNotices((current) => ({ ...current, [issueSectionId]: copy.reply.sectionUploading }));
    const done = () => {
      sectionUploadLocks.current.delete(lockKey);
      setSectionUploading((current) => ({ ...current, [issueSectionId]: false }));
    };
    const prepared = await prepareImage(picked, PHOTO_TARGET);
    if (!prepared.ok) {
      done();
      setSectionNotices((current) => ({ ...current, [issueSectionId]: null }));
      setSectionErrors((current) => ({ ...current, [issueSectionId]: copy.reply.errors.photoUnreadable }));
      return;
    }
    const result = await uploadReplySectionPhoto(token, issueSectionId, prepared.file, caption, position, copy.reply.errors.photoUploadFailed);
    done();
    if (result.ok) {
      setSectionMediaLists((current) => ({
        ...current,
        [issueSectionId]: [
          ...(current[issueSectionId] ?? []),
          { id: result.mediaId, url: result.url, caption: kind === "photo_wall" ? caption || null : null },
        ],
      }));
      setSectionSaveStates((current) => ({ ...current, [issueSectionId]: "saved" }));
      setSectionNotices((current) => ({ ...current, [issueSectionId]: copy.reply.sectionUploaded }));
      setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    } else {
      setSectionNotices((current) => ({ ...current, [issueSectionId]: null }));
      setSectionErrors((current) => ({ ...current, [issueSectionId]: result.error }));
    }
  }, [token]);

  const removeSectionPhoto = useCallback(async (issueSectionId: string, mediaId: string, remaining: number) => {
    setSectionNotices((current) => ({ ...current, [issueSectionId]: null }));
    setSectionErrors((current) => ({ ...current, [issueSectionId]: null }));
    const result = await removeReplySectionMedia(token, issueSectionId, mediaId, copy.reply.errors.photoRemoveFailed);
    if (result.ok) {
      // The photo's own Remove button is gone; the empty slot is the natural next stop.
      pendingFocus.current = [`section-photo-${issueSectionId}-${remaining}`];
      setSectionMediaLists((current) => ({
        ...current,
        [issueSectionId]: (current[issueSectionId] ?? []).filter((item) => item.id !== mediaId),
      }));
      setSectionNotices((current) => ({ ...current, [issueSectionId]: copy.reply.sectionRemoved }));
    } else {
      setSectionErrors((current) => ({ ...current, [issueSectionId]: result.error }));
    }
  }, [token]);

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
      // Clear first, so the same failure twice is announced twice.
      setError(null);
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

  /** A tap saves straight away, in order, so the last tap always wins. */
  const choosePoll = useCallback(
    async (questionId: string, next: number[]) => {
      const revision = (pollRevisions.current.get(questionId) ?? 0) + 1;
      pollRevisions.current.set(questionId, revision);
      setPollPicks((current) => ({ ...current, [questionId]: next }));
      setPollStatuses((current) => ({ ...current, [questionId]: "saving" }));
      setError(null);
      const result = await writePoll(questionId, JSON.stringify(next));
      if (pollRevisions.current.get(questionId) !== revision) return;
      if (result.ok) {
        setPollStatuses((current) => ({ ...current, [questionId]: next.length > 0 ? "saved" : "cleared" }));
        setError(null);
      } else {
        setPollStatuses((current) => ({ ...current, [questionId]: "error" }));
        setError(result.error);
      }
    },
    [writePoll],
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
    if (photoLocks.current.size > 0 || sectionUploadLocks.current.size > 0) return;
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
    setSending(true);
    setSubmitFailed(false);
    setError(null);
    setAnnouncement("");

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
        // Poll picks save the moment they are tapped; there is no draft text to flush.
        if (question.kind === "poll") continue;
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

      setConfirmation(sent ? "updated" : "sent");
      setSent(true);
      setAnimateSentStamp(true);
      setAnnouncement(copy.a11yStatus.sentAnnouncement);
    } catch {
      setError(copy.reply.genericError);
      setSubmitFailed(true);
    } finally {
      setSending(false);
    }
  }, [bodies, name, questions, sent, token, writeDraft]);

  // Each view starts at the top with focus on its heading, so a screen reader hears the change.
  useEffect(() => {
    if (confirmation === null) return;
    window.scrollTo({ top: 0 });
    confirmationHeading.current?.focus();
  }, [confirmation]);

  /** Send with nothing in it: say so beside the first question and put the cursor there. */
  const nudgeToFirstQuestion = useCallback(() => {
    setNudged(true);
    const fields = "textarea, input[type=radio], input[type=checkbox], input:not([type])";
    const first =
      questionList.current?.querySelector<HTMLElement>(fields) ??
      sectionList.current?.querySelector<HTMLElement>(fields);
    first?.focus({ preventScroll: true });
    nudgeMessage.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const editAnswers = useCallback(() => {
    setConfirmation(null);
    // The sheet is unhidden on the next paint; move there once it is.
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0 });
      sheetHeading.current?.focus();
    });
  }, []);

  return (
    <>
      <header className="reply-topbar stitched sticky top-0 z-20 border-b bg-page/85 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-[600px] items-center justify-between gap-3 px-4 py-2">
          <span className="flex min-w-0 items-center gap-2 font-display text-[23px] font-bold text-ink">
            <Cherries className="h-7 w-7 flex-none" /><span className="wrap-any">{loopName}</span>
          </span>
          <span className="chip flex h-7 flex-none items-center whitespace-nowrap border bg-card px-3 text-[12px] font-bold text-ink-soft numeric">
            {text(copy.reply.answered, { answered, total })}
          </span>
        </div>
      </header>

      {confirmation ? (
        <main className="mx-auto w-full max-w-[600px] px-4 pb-16 pt-7" aria-labelledby="reply-confirmation-heading">
          <LoopBanner url={headerImageUrl} className="mb-5" />
          <section className="card relative mt-2 p-6 pt-8 text-center sm:p-8 sm:pt-10">
            <Tape tone="dots" />
            <svg viewBox="0 0 20 20" aria-hidden className={`sent-stamp mx-auto h-14 w-14${animateSentStamp ? " sent-stamp-animate" : ""}`}>
              <path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" />
            </svg>
            <h1
              ref={confirmationHeading}
              tabIndex={-1}
              id="reply-confirmation-heading"
              className="mt-4 text-ink outline-none"
            >
              {confirmation === "updated" ? copy.reply.confirmation.updatedTitle : copy.reply.confirmation.sentTitle}
            </h1>
            <p className="mt-2 text-[16px] leading-relaxed text-ink">
              {text(copy.reply.confirmation.body, { round: issueTitle(copy.reply.round, roundNumber, roundName) })}
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">
              {text(copy.reply.confirmation.delivery, { deadline: deadlineBoth })}
            </p>
            <button type="button" onClick={editAnswers} className="btn btn-primary mt-6 min-h-12 w-full sm:w-auto sm:px-8">
              {copy.reply.confirmation.edit}
            </button>
            {canSuggest ? (
              <p className="mt-4 text-[13px] leading-relaxed text-ink-muted">
                <Link
                  href={`/r/${token}/suggest`}
                  className="font-medium text-ink underline decoration-line-strong underline-offset-4"
                >
                  {copy.reply.suggestLink}
                </Link>
              </p>
            ) : null}
          </section>
        </main>
      ) : null}

      <main className="mx-auto w-full max-w-[600px] px-4 pb-36 pt-7" hidden={confirmation !== null}>
        <LoopBanner url={headerImageUrl} className="mb-5" />
        <div className="relative pr-16">
          <Cherries className="absolute -top-2 right-0 h-16 w-16 rotate-12" />
          <p className="eyebrow">{text(copy.reply.hi, { name: name.trim() || displayName })}</p>
          <h1 ref={sheetHeading} tabIndex={-1} className="mt-1 text-ink outline-none">{issueTitle(copy.reply.round, roundNumber, roundName)}</h1>
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
            aria-invalid={nameStatus === "error" ? "true" : undefined}
            aria-describedby="reply-name-status"
            placeholder={copy.reply.namePlaceholder}
            disabled={sending}
            className="field mt-1.5 h-11 py-0"
          />
          <p
            id="reply-name-status"
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
          <div className="mt-3 border-t border-dashed border-line pt-3">
            <p className="mb-2 text-[13px] font-medium text-ink-soft">{copy.identity.profile.title}</p>
            <ProfilePhoto endpoint={`/api/reply/${token}/profile-photo`} name={name.trim() || displayName} photoUrl={photoUrl} />
          </div>
        </section>

        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
        {sent ? (
          <div className="notice settle mt-6 flex items-start gap-3 border bg-accent-soft px-4 py-3">
            <svg viewBox="0 0 20 20" aria-hidden className={`sent-stamp mt-0.5 h-4 w-4 flex-none${animateSentStamp ? " sent-stamp-animate" : ""}`}>
              <path d="M10 1.7a8.3 8.3 0 100 16.6 8.3 8.3 0 000-16.6zm3.8 6.4l-4.4 4.7a.9.9 0 01-1.3 0L6.2 10.9a.9.9 0 111.3-1.3l1.2 1.3 3.8-4a.9.9 0 011.3 1.2z" />
            </svg>
            <p className="text-[14px] leading-relaxed text-ink">
              {text(copy.reply.sent, { deadline: deadlineBoth })}
            </p>
          </div>
        ) : null}

        <p
          ref={nudgeMessage}
          id="reply-nothing-to-send"
          role="alert"
          className={showNudge ? "notice mt-6 scroll-mt-24 border bg-accent-soft px-4 py-3 text-[14px] font-bold leading-relaxed text-ink" : "scroll-mt-24"}
        >
          {showNudge ? copy.reply.nothingToSend : null}
        </p>

        <div ref={questionList} className={showNudge ? "mt-4 flex flex-col gap-6" : "mt-7 flex flex-col gap-6"}>
          {questions.map((question, index) => {
            if (question.kind === "poll") {
              return (
                <PollCard
                  key={question.id}
                  id={question.id}
                  index={index}
                  prompt={question.text}
                  options={question.pollOptions}
                  multiple={question.pollMultiple}
                  picks={pollPicks[question.id] ?? []}
                  status={pollStatuses[question.id] ?? "idle"}
                  disabled={sending}
                  onChange={(next) => void choosePoll(question.id, next)}
                />
              );
            }
            // Names carry the card's number, not its text, so each stays unique and none repeats the question.
            const forQuestion = (label: string) => text(copy.a11yLabels.forQuestionNumber, { label, n: index + 1 });
            const photoState = photoStates[question.id] ?? "idle";
            const photoUrl = photoUrls[question.id];
            const preview = photoPreviews[question.id];
            const photoBusyForCard = photoState === "uploading" || photoState === "removing";
            // aria-disabled, not disabled: a control the keyboard is on must not drop focus mid-request.
            const photoBlocked = sending || photoBusyForCard;
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
            const isRecordingHere = recording?.questionId === question.id;
            const voiceBlocked = sending || voiceBusyForCard;
            const recordBlocked = sending || voiceBusyForCard || Boolean(recording) || stopping;
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
                    <button type="button" className="min-h-11 underline underline-offset-2" onClick={() => { pendingFocus.current = [`reply-${question.id}`]; void persist(question.id, bodies[question.id] ?? ""); }}>
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

              {(audioPreview || audioUrl) ? (
                <audio
                  controls
                  preload="metadata"
                  src={audioPreview ?? audioUrl ?? ""}
                  aria-label={text(copy.reply.voiceDurationLabel, { duration: formatAudioDuration(audioDurations[question.id] ?? 0) })}
                  className="mt-3 w-full"
                />
              ) : null}

              {/* Photo and voice share one quiet row inside the card they belong to. */}
              <div className="mt-4 flex flex-wrap items-center gap-x-5 border-t border-dashed border-line pt-1">
                <div className="flex flex-wrap items-center gap-x-5">
                  <input
                    id={`photo-${question.id}`}
                    type="file"
                    accept={PHOTO_ACCEPT}
                    className="peer sr-only"
                    aria-disabled={photoBlocked ? true : undefined}
                    aria-label={forQuestion(photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto)}
                    aria-describedby={`photo-help-${question.id}`}
                    onClick={(event) => {
                      if (photoBlocked) event.preventDefault();
                    }}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = "";
                      if (file && !photoBlocked) void selectPhoto(question.id, file);
                    }}
                  />
                  <label
                    htmlFor={`photo-${question.id}`}
                    className="inline-flex min-h-11 items-center rounded-sm text-[13px] font-bold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink peer-aria-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent-ink peer-focus-visible:outline-offset-2"
                  >
                    {photoUrl ? copy.reply.replacePhoto : copy.reply.addPhoto}
                  </label>
                  {showRemove ? (
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center rounded-sm text-[13px] font-bold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                      aria-label={forQuestion(copy.reply.removePhoto)}
                      aria-disabled={photoBlocked ? true : undefined}
                      onClick={() => {
                        if (!photoBlocked) void removePhoto(question.id);
                      }}
                    >
                      {copy.reply.removePhoto}
                    </button>
                  ) : null}
                </div>

                <div role="group" aria-label={forQuestion(copy.reply.voiceGroup)} className="flex flex-wrap items-center gap-x-5">
                  {isRecordingHere ? (
                    // Visual only: a ticking live region would be read out every second.
                    <p className="text-[13px] font-medium text-ink numeric" aria-hidden="true">
                      {text(copy.reply.voiceRecording, { elapsed: formatAudioDuration(recordingElapsed) })}
                    </p>
                  ) : null}
                  {/* One button for Record and Stop, so keyboard focus stays where it was. */}
                  {canRecord || isRecordingHere ? (
                    <button
                      id={`record-${question.id}`}
                      type="button"
                      className={`${isRecordingHere ? "btn btn-primary min-h-11 px-4 text-[13px]" : "inline-flex min-h-11 items-center rounded-sm text-[13px] font-bold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"} aria-disabled:cursor-not-allowed aria-disabled:opacity-45`}
                      aria-label={forQuestion(isRecordingHere ? copy.reply.voiceStop : audioUrl ? copy.reply.voiceReplace : copy.reply.voiceRecord)}
                      aria-describedby={`voice-help-${question.id}`}
                      aria-disabled={(isRecordingHere ? stopping : recordBlocked) ? true : undefined}
                      onClick={() => {
                        if (isRecordingHere) stopRecording(question.id, false);
                        else if (!recordBlocked) void startRecording(question.id);
                      }}
                    >
                      {isRecordingHere ? copy.reply.voiceStop : audioUrl ? copy.reply.voiceReplace : copy.reply.voiceRecord}
                    </button>
                  ) : null}
                  {isRecordingHere ? null : (
                    <>
                      <input
                        id={`audio-${question.id}`}
                        type="file"
                        accept={AUDIO_ACCEPT}
                        className="peer sr-only"
                        aria-describedby={`voice-help-${question.id}`}
                        aria-disabled={voiceBlocked || recording ? true : undefined}
                        onClick={(event) => {
                          if (voiceBlocked || recording) event.preventDefault();
                        }}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file && !voiceBlocked && !recording) pickAudioFile(question.id, file);
                          event.target.value = "";
                        }}
                      />
                      <label
                        htmlFor={`audio-${question.id}`}
                        className="inline-flex min-h-11 items-center rounded-sm text-[13px] font-bold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink peer-aria-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent-ink peer-focus-visible:outline-offset-2"
                      >
                        {copy.reply.voicePick}
                      </label>
                      {showVoiceRemove ? (
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center rounded-sm text-[13px] font-bold text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                          aria-label={forQuestion(copy.reply.voiceRemove)}
                          aria-disabled={voiceBlocked ? true : undefined}
                          onClick={() => {
                            if (!voiceBlocked) void removeAudio(question.id);
                          }}
                        >
                          {copy.reply.voiceRemove}
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              {!canRecord && !audioUrl && !isRecordingHere ? (
                <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">
                  {secureContext ? copy.reply.voiceNoRecorder : copy.reply.voiceInsecure}
                </p>
              ) : null}
              {/* Format and size limits stay with the controls for assistive tech, and show when something went wrong. */}
              <p
                id={`photo-help-${question.id}`}
                className={photoState === "uploadError" ? "mt-2 text-[12px] leading-relaxed text-ink-muted" : "sr-only"}
              >
                {copy.reply.photoFormats}
              </p>
              <p
                id={`voice-help-${question.id}`}
                className={audioState === "uploadError" ? "mt-2 text-[12px] leading-relaxed text-ink-muted" : "sr-only"}
              >
                {copy.reply.voiceFormats}
              </p>
              <LiveMessage
                id={`photo-status-${question.id}`}
                message={photoStatusText}
                isError={photoState === "uploadError" || photoState === "removeError"}
              />
              {(photoState === "removeError" || (photoState === "uploadError" && retryablePhotos[question.id])) ? (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  aria-disabled={photoBlocked ? true : undefined}
                  onClick={() => {
                    if (!photoBlocked) retryPhoto(question.id);
                  }}
                >
                  {photoState === "removeError" ? copy.reply.retryPhotoRemove : copy.reply.retryPhotoUpload}
                </button>
              ) : null}
              <LiveMessage
                id={`audio-status-${question.id}`}
                message={audioStatusText}
                isError={audioState === "uploadError" || audioState === "removeError"}
              />
              {(audioState === "removeError" || (audioState === "uploadError" && retryableAudio[question.id] && !recording)) ? (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                  aria-disabled={voiceBlocked ? true : undefined}
                  onClick={() => {
                    if (!voiceBlocked) retryAudio(question.id);
                  }}
                >
                  {audioState === "removeError" ? copy.reply.voiceRetryRemove : copy.reply.voiceRetryUpload}
                </button>
              ) : null}
            </section>
            );
          })}
        </div>

        {sections.length > 0 ? (
          <section ref={sectionList} className="mt-8" aria-label={copy.reply.sectionsHeading}>
            <h2 className="font-display text-[25px] font-bold leading-[1.15] text-ink">{copy.reply.sectionsHeading}</h2>
            {sections.map((section) => {
              const media = sectionMediaLists[section.id] ?? [];
              const saveState = sectionSaveStates[section.id] ?? "idle";
              const cap = section.kind === "photo_wall" ? 6 : 1;
              return (
                <div key={section.id} className="card paper ride-in mt-4 block p-5 pt-6">
                  <h3 className="font-display text-[22px] font-bold leading-tight text-ink">
                    {section.emoji ? <span className="mr-2">{section.emoji}</span> : null}
                    {section.title}
                  </h3>
                  {section.description ? (
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink-soft">{section.description}</p>
                  ) : null}

                  {section.kind === "music" ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <input
                        id={`section-link-${section.id}`}
                        value={sectionLinks[section.id] ?? ""}
                        onChange={(event) => setSectionLinks((current) => ({ ...current, [section.id]: event.target.value }))}
                        placeholder={copy.reply.sectionMusicPlaceholder}
                        aria-label={copy.reply.sectionMusicLabel}
                        maxLength={500}
                        disabled={sending}
                        className="field h-[46px] py-0"
                      />
                      <input
                        value={sectionCaptions[section.id] ?? ""}
                        onChange={(event) => setSectionCaptions((current) => ({ ...current, [section.id]: event.target.value }))}
                        placeholder={copy.reply.sectionCaptionPlaceholder}
                        aria-label={copy.reply.sectionCaptionLabel}
                        maxLength={120}
                        disabled={sending}
                        className="field h-[46px] py-0"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="btn btn-primary min-h-11 px-4 text-[13px]"
                          onClick={() => void saveSection(section.id)}
                          disabled={sending}
                        >
                          {copy.reply.sectionMusicSave}
                        </button>
                        {(sectionLinks[section.id] ?? "") ? (
                          <button
                            type="button"
                            className="btn btn-quiet min-h-11 px-4 text-[13px] aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                            aria-disabled={sending ? true : undefined}
                            onClick={() => {
                              if (sending) return;
                              // This button leaves with the link; the field it cleared is where focus goes.
                              pendingFocus.current = [`section-link-${section.id}`];
                              setSectionLinks((current) => ({ ...current, [section.id]: "" }));
                              void saveSection(section.id, "");
                            }}
                          >
                            {copy.reply.sectionMusicClear}
                          </button>
                        ) : null}
                        <span aria-live="polite" className="text-[12.5px] text-ink-muted">
                          {saveState === "saving" ? copy.reply.sectionSaving : saveState === "saved" ? copy.reply.sectionDraftSaved : null}
                        </span>
                      </div>
                      <p role="alert" className={sectionErrors[section.id] ? "text-[13px] leading-relaxed text-danger" : undefined}>
                        {sectionErrors[section.id]}
                      </p>
                    </div>
                  ) : null}

                  {section.kind === "standard" ? (
                    <div className="mt-3">
                      <textarea
                        value={sectionBodies[section.id] ?? ""}
                        onChange={(event) => setSectionBodies((current) => ({ ...current, [section.id]: event.target.value }))}
                        onBlur={() => saveSectionText(section.id)}
                        placeholder={copy.reply.placeholder}
                        aria-label={section.title}
                        rows={3}
                        maxLength={2000}
                        disabled={sending}
                        className="field lined-field w-full py-2"
                      />
                      <p aria-live="polite" className="mt-1 text-[12px] text-ink-muted">
                        {saveState === "saving" ? copy.reply.sectionSaving : saveState === "saved" ? copy.reply.sectionDraftSaved : null}
                      </p>
                      <p role="alert" className={sectionErrors[section.id] ? "text-[13px] leading-relaxed text-danger" : undefined}>
                        {sectionErrors[section.id]}
                      </p>
                    </div>
                  ) : null}

                  {(section.kind === "standard" || section.kind === "photo_wall") ? (
                    <div className="mt-3">
                      {media.map((item, index) => (
                        <div key={item.id} className="mt-2 flex items-start gap-3">
                          <img src={item.url} alt={item.caption || copy.reply.photoPreview} className="h-16 w-16 flex-none rounded-md border border-line object-cover" />
                          <div className="min-w-0 flex-1">
                            {item.caption ? (
                              <p className="wrap-any text-[13px] text-ink">{item.caption}</p>
                            ) : null}
                            <button
                              type="button"
                              className="mt-1 min-h-11 text-[13px] font-bold text-ink underline underline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
                              aria-disabled={sending ? true : undefined}
                              onClick={() => {
                                if (!sending) void removeSectionPhoto(section.id, item.id, media.length - 1);
                              }}
                            >
                              {copy.reply.sectionRemovePhoto}
                            </button>
                          </div>
                          <span className="text-[12px] text-ink-muted numeric">{index + 1}/{cap}</span>
                        </div>
                      ))}
                      {media.length < cap ? (
                        <PhotoSlot
                          sectionId={section.id}
                          kind={section.kind}
                          position={media.length}
                          disabled={sending || Boolean(sectionUploading[section.id])}
                          onPick={(file, caption) => void uploadSectionPhoto(section.id, section.kind, file, caption, media.length)}
                        />
                      ) : null}
                      <p role="status" aria-live="polite" className={sectionNotices[section.id] ? "mt-2 text-[13px] text-ink-muted" : undefined}>
                        {sectionNotices[section.id]}
                      </p>
                      {/* Standard sections already carry their one alert above the photos. */}
                      {section.kind === "photo_wall" ? (
                        <p role="alert" className={sectionErrors[section.id] ? "mt-2 text-[13px] leading-relaxed text-danger" : undefined}>
                          {sectionErrors[section.id]}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null}

        <p role="alert" className={error ? "mt-4 text-[14px] leading-relaxed text-danger" : undefined}>
          {error}
        </p>

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

        {mutedUnsubscribeToken ? <MutedNotice unsubscribeToken={mutedUnsubscribeToken} back={`/r/${token}`} /> : null}

        <ReminderPreference token={token} initial={reminderPreference} />

        <p className="mt-6 flex flex-wrap gap-x-4 gap-y-2 text-[13px] leading-relaxed text-ink-muted">
          <Link href={`/r/${token}/leave`} className="underline decoration-line-strong underline-offset-4 hover:text-ink">
            {copy.reply.leaveLink}
          </Link>
          <Link href="/privacy" className="underline decoration-line-strong underline-offset-4 hover:text-ink">
            {copy.legal.privacyLink}
          </Link>
        </p>
      </main>

      <section
        aria-label={copy.a11yLabels.sendBar}
        hidden={confirmation !== null}
        className="reply-actionbar stitched-top fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-md"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <div className="mx-auto flex w-full max-w-[600px] items-center justify-between gap-3 px-4 pt-3">
          <span className="text-[13px] font-medium text-ink-soft numeric">
            {sent ? copy.reply.sentState : text(copy.reply.answered, { answered, total })}
          </span>
          {/* aria-disabled, not disabled: the button the keyboard is on must not vanish mid-send. */}
          <button
            type="button"
            onClick={() => {
              if (sendBlocked) return;
              if (nothingToSend) nudgeToFirstQuestion();
              else void onSend();
            }}
            aria-disabled={sendBlocked ? true : undefined}
            aria-describedby={showNudge ? "reply-nothing-to-send" : undefined}
            className="btn btn-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-45"
          >
            {sending ? copy.reply.sending : sent ? copy.reply.saveChanges : copy.reply.sendAnswers}
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * Status text and error text each get a region that is always mounted, so the
 * words are announced when they change rather than lost when the node appears.
 */
function LiveMessage({ id, message, isError }: { id: string; message: string | null | undefined; isError: boolean }) {
  const shape = "mt-2 text-[13px] leading-relaxed";
  return (
    <>
      <p id={id} role="status" aria-live="polite" aria-atomic="true" className={!isError && message ? `${shape} text-ink-muted` : undefined}>
        {isError ? null : message}
      </p>
      <p id={`${id}-error`} role="alert" aria-atomic="true" className={isError && message ? `${shape} text-danger` : undefined}>
        {isError ? message : null}
      </p>
    </>
  );
}

/** One photo slot on a standard section or photo wall. Photo walls require a caption. */
function PhotoSlot({
  sectionId,
  kind,
  position,
  disabled,
  onPick,
}: {
  sectionId: string;
  kind: "standard" | "photo_wall";
  position: number;
  disabled: boolean;
  onPick: (file: File, caption: string) => void;
}) {
  const id = `section-photo-${sectionId}-${position}`;
  const [caption, setCaption] = useState("");
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {kind === "photo_wall" ? (
        <input
          value={caption}
          onChange={(event) => setCaption(event.target.value)}
          placeholder={copy.reply.sectionPhotoCaptionPlaceholder}
          aria-label={copy.reply.sectionCaptionLabel}
          aria-required="true"
          maxLength={200}
          disabled={disabled}
          className="field h-[46px] min-w-44 flex-1 py-0"
        />
      ) : null}
      <input
        id={id}
        type="file"
        accept={PHOTO_ACCEPT}
        className="peer sr-only"
        aria-disabled={disabled ? true : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file && !disabled) onPick(file, caption);
          setCaption("");
          event.target.value = "";
        }}
      />
      <label
        htmlFor={id}
        className="btn btn-quiet min-h-11 px-4 text-[13px] peer-aria-disabled:opacity-45 peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-accent-ink peer-focus-visible:outline-offset-2"
      >
        {kind === "photo_wall" ? copy.reply.sectionAddPhoto : copy.reply.sectionAddPhoto}
      </label>
    </div>
  );
}

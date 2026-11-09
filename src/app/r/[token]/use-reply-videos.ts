"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { prepareVideo, type PreparedVideo } from "@/components/prepare-video";
import { copy, text } from "@/lib/copy";
import { removeReplyVideo, uploadReplyVideo } from "@/components/video-upload";
import type { VideoUploadMode } from "@/lib/video-storage";

export type SavedVideo = { url: string; posterUrl: string; durationMs: number };

export type VideoStatus =
  | "idle"
  | "preparing"
  | "uploading"
  | "saved"
  | "trimmed"
  | "removing"
  | "removed"
  | "uploadError"
  | "removeError";

type Ready = Extract<PreparedVideo, { ok: true }>;

function set<T>(setter: React.Dispatch<React.SetStateAction<Record<string, T>>>, id: string, value: NoInfer<T>) {
  setter((current) => ({ ...current, [id]: value }));
}

export function preparedError(reason: Exclude<PreparedVideo, { ok: true }>["reason"]): string | null {
  if (reason === "cancelled") return null;
  if (reason === "too-long") return copy.reply.errors.videoTooLong;
  if (reason === "too-large") return copy.reply.errors.videoTooLarge;
  return copy.reply.errors.videoUnreadable;
}

/**
 * Each written answer's clip: picked, shrunk on the device, sent, attached.
 * Kept out of the sheet's own state so its many steps (and the progress they
 * report) don't add to it; the sheet reads `videos` to count an answer as
 * written and `busy` to hold Done while a clip is on its way.
 */
export function useReplyVideos(token: string, mode: VideoUploadMode, initial: Array<{ id: string; video: SavedVideo | null }>) {
  const [videos, setVideos] = useState<Record<string, SavedVideo | null>>(() =>
    Object.fromEntries(initial.map((item) => [item.id, item.video])),
  );
  const [states, setStates] = useState<Record<string, VideoStatus>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  /** The still of a clip on its way, shown while it uploads. */
  const [previews, setPreviews] = useState<Record<string, string | null>>({});
  const pending = useRef(new Map<string, Ready>());
  /** Mirrors `pending` for rendering: which failed clips are still on the device to send again. */
  const [kept, setKept] = useState<Record<string, boolean>>({});
  const aborts = useRef(new Map<string, AbortController>());
  const objectUrls = useRef(new Map<string, string>());
  const locks = useRef(new Set<string>());

  const clearPreview = useCallback((id: string) => {
    const url = objectUrls.current.get(id);
    if (url) URL.revokeObjectURL(url);
    objectUrls.current.delete(id);
    setPreviews((current) => ({ ...current, [id]: null }));
  }, []);

  useEffect(() => {
    const urls = objectUrls.current;
    const running = aborts.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      for (const controller of running.values()) controller.abort();
    };
  }, []);

  const send = useCallback(async (id: string, ready: Ready) => {
    locks.current.add(id);
    set(setStates, id, "uploading");
    set(setProgress, id, 0);
    set(setErrors, id, null);
    const result = await uploadReplyVideo({
      token,
      issueQuestionId: id,
      mode,
      video: ready.video,
      extension: ready.extension,
      contentType: ready.contentType,
      poster: ready.poster,
      durationMs: ready.durationMs,
      onProgress: (fraction) => set(setProgress, id, Math.round(fraction * 100)),
    });
    locks.current.delete(id);
    if (result.ok) {
      pending.current.delete(id);
      set(setKept, id, false);
      clearPreview(id);
      set(setVideos, id, { url: result.videoUrl, posterUrl: result.posterUrl, durationMs: result.durationMs });
      set(setStates, id, ready.trimmed ? "trimmed" : "saved");
      return;
    }
    // A refusal (too big, wrong question) won't go better on a second try.
    if (result.rejected) {
      pending.current.delete(id);
      set(setKept, id, false);
      clearPreview(id);
    }
    set(setStates, id, "uploadError");
    set(setErrors, id, navigator.onLine === false ? copy.common.offlineUpload : result.error);
  }, [clearPreview, mode, token]);

  const pick = useCallback(async (id: string, file: File) => {
    if (locks.current.has(id)) return;
    locks.current.add(id);
    pending.current.delete(id);
    set(setKept, id, false);
    clearPreview(id);
    const controller = new AbortController();
    aborts.current.set(id, controller);
    set(setStates, id, "preparing");
    set(setProgress, id, 0);
    set(setErrors, id, null);
    const ready = await prepareVideo(file, (fraction) => set(setProgress, id, Math.round(fraction * 100)), controller.signal);
    aborts.current.delete(id);
    locks.current.delete(id);
    if (!ready.ok) {
      const error = preparedError(ready.reason);
      set(setStates, id, error ? "uploadError" : "idle");
      set(setErrors, id, error);
      return;
    }
    pending.current.set(id, ready);
    set(setKept, id, true);
    const still = URL.createObjectURL(ready.poster);
    objectUrls.current.set(id, still);
    set(setPreviews, id, still);
    await send(id, ready);
  }, [clearPreview, send]);

  /** Stop shrinking a clip that is taking too long. */
  const cancel = useCallback((id: string) => {
    aborts.current.get(id)?.abort();
  }, []);


  const remove = useCallback(async (id: string) => {
    if (locks.current.has(id)) return;
    const hadPending = pending.current.delete(id);
    set(setKept, id, false);
    clearPreview(id);
    set(setErrors, id, null);
    if (!videos[id]) {
      set(setStates, id, hadPending ? "removed" : "idle");
      return;
    }
    locks.current.add(id);
    set(setStates, id, "removing");
    const result = await removeReplyVideo(token, id);
    locks.current.delete(id);
    if (result.ok) {
      set(setVideos, id, null);
      set(setStates, id, "removed");
    } else {
      set(setStates, id, "removeError");
      set(setErrors, id, result.error);
    }
  }, [clearPreview, token, videos]);

  const retry = useCallback((id: string) => {
    if (states[id] === "removeError") {
      void remove(id);
      return;
    }
    const ready = pending.current.get(id);
    if (ready && !locks.current.has(id)) void send(id, ready);
  }, [remove, send, states]);

  const busy = useMemo(
    () => Object.values(states).some((state) => state === "preparing" || state === "uploading" || state === "removing"),
    [states],
  );

  const statusText = (id: string): string | null => {
    const state = states[id] ?? "idle";
    if (state === "preparing") return text(copy.reply.videoPreparing, { percent: progress[id] ?? 0 });
    if (state === "uploading") return text(copy.reply.videoUploading, { percent: progress[id] ?? 0 });
    if (state === "removing") return copy.reply.videoRemoving;
    if (state === "saved") return copy.reply.videoSaved;
    if (state === "trimmed") return copy.reply.videoTrimmed;
    if (state === "removed") return copy.reply.videoRemoved;
    return errors[id] ?? null;
  };

  /** A clip that failed to send and can be sent again from what is still on the device. */
  const retryable = (id: string) => (states[id] === "uploadError" && Boolean(kept[id])) || states[id] === "removeError";

  return { videos, states, previews, busy, pick, cancel, retry, remove, statusText, retryable };
}

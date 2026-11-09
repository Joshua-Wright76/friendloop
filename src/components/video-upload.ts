import { copy } from "@/lib/copy";
import type { VideoUploadMode } from "@/lib/video-storage";

export type VideoSaveResult =
  | { ok: true; savedAt: string; videoUrl: string; posterUrl: string; durationMs: number; mediaId?: string }
  | { ok: false; error: string; rejected?: boolean };

export type VideoUpload = {
  token: string;
  issueQuestionId: string;
  mode: VideoUploadMode;
  video: Blob;
  extension: string;
  contentType: string;
  poster: File;
  durationMs: number;
  /** A photo wall's caption and slot; ignored on a written answer. */
  caption?: string;
  position?: number;
  /** 0–1 while the clip itself is sent. */
  onProgress?: (fraction: number) => void;
};

function randomName(extension: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `reply-videos/${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}.${extension}`;
}

type Answer = { status: number; data: { ok?: boolean; error?: string; savedAt?: string; videoUrl?: string; posterUrl?: string; durationMs?: number; mediaId?: string } };

/** A form POST with upload progress, which fetch can't report. */
function sendForm(url: string, form: FormData, onProgress?: (fraction: number) => void): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", url);
    request.responseType = "json";
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    request.onload = () => resolve({ status: request.status, data: (request.response ?? {}) as Answer["data"] });
    request.onerror = () => reject(new Error("network"));
    request.send(form);
  });
}

/**
 * Send a prepared clip and attach it. In production the clip goes straight to
 * Blob (our route only signs it), then a small form tells the app where it is;
 * locally the clip rides in that form itself.
 */
export async function uploadReplyVideo(input: VideoUpload): Promise<VideoSaveResult> {
  const generic = copy.reply.errors.videoUploadFailed;
  const form = new FormData();
  form.set("issueQuestionId", input.issueQuestionId);
  form.set("durationMs", String(input.durationMs));
  form.set("poster", input.poster, input.poster.name);
  if (input.caption !== undefined) form.set("caption", input.caption);
  if (input.position !== undefined) form.set("position", String(input.position));

  try {
    if (input.mode === "blob") {
      const { upload } = await import("@vercel/blob/client");
      let blobUrl: string;
      try {
        const blob = await upload(randomName(input.extension), input.video, {
          access: "public",
          handleUploadUrl: `/api/reply/${input.token}/video/upload`,
          clientPayload: JSON.stringify({ issueQuestionId: input.issueQuestionId }),
          contentType: input.contentType,
          multipart: input.video.size > 8 * 1024 * 1024,
          onUploadProgress: ({ percentage }) => input.onProgress?.(percentage / 100),
        });
        blobUrl = blob.url;
      } catch (error) {
        // The signing route's refusal (rate limit, wrong question) comes back as the error's message.
        const message = error instanceof Error ? error.message : "";
        const known = Object.values(copy.reply.errors).find((text) => message.includes(text));
        return { ok: false, error: known ?? generic, ...(known ? { rejected: true } : {}) };
      }
      form.set("videoUrl", blobUrl);
      const response = await fetch(`/api/reply/${input.token}/video`, { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as Answer["data"];
      return settle({ status: response.status, data }, generic);
    }

    form.set("video", input.video, `video.${input.extension}`);
    return settle(await sendForm(`/api/reply/${input.token}/video`, form, input.onProgress), generic);
  } catch {
    return { ok: false, error: generic };
  }
}

function settle({ status, data }: Answer, generic: string): VideoSaveResult {
  if (status === 413 && !data.error) return { ok: false, error: copy.reply.errors.videoTooLarge, rejected: true };
  if (status >= 400 || !data.ok || !data.videoUrl || !data.posterUrl) {
    return { ok: false, error: data.error ?? generic, ...(status >= 400 && status < 500 ? { rejected: true } : {}) };
  }
  return {
    ok: true,
    savedAt: data.savedAt ?? "",
    videoUrl: data.videoUrl,
    posterUrl: data.posterUrl,
    durationMs: data.durationMs ?? 0,
    ...(data.mediaId ? { mediaId: data.mediaId } : {}),
  };
}

export async function removeReplyVideo(token: string, issueQuestionId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/reply/${token}/video`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueQuestionId }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    return response.ok && data.ok ? { ok: true } : { ok: false, error: data.error ?? copy.reply.errors.videoRemoveFailed };
  } catch {
    return { ok: false, error: copy.reply.errors.videoRemoveFailed };
  }
}

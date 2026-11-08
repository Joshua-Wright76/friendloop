
import { copy } from "./copy.ts";
import { readUploadResponse } from "./upload-response.ts";

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };
export type PhotoSaveResult =
  | { ok: true; savedAt: string; photoUrl: string }
  | { ok: false; error: string; rejected?: boolean };

async function parseSaveResult(response: Response, genericError: string): Promise<SaveResult> {
  const data = (await response.json()) as { ok?: boolean; savedAt?: string; error?: string };
  if (!response.ok || !data.ok) return { ok: false, error: data.error ?? genericError };
  return { ok: true, savedAt: data.savedAt ?? "" };
}

export async function postReply(
  token: string,
  payload: Record<string, unknown>,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const response = await fetcher(`/api/reply/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await parseSaveResult(response, genericError);
  } catch {
    return { ok: false, error: genericError };
  }
}

/**
 * Photos go through our own route, as one small request. The browser has already
 * shrunk them (see prepare-image), so they sit well inside Vercel's 4.5 MB body
 * limit and no direct-to-Blob hand-off, with its callback and polling, is needed.
 */
export async function uploadReplyPhoto(
  token: string,
  issueQuestionId: string,
  file: File,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<PhotoSaveResult> {
  try {
    const form = new FormData();
    form.set("issueQuestionId", issueQuestionId);
    form.set("photo", file, file.name);
    const response = await fetcher(`/api/reply/${token}/photo`, { method: "POST", body: form });
    const data = await readUploadResponse<{
      ok?: boolean;
      savedAt?: string;
      photoUrl?: string;
      error?: string;
    }>(response, copy.reply.errors.photoTooLarge);
    if (!response.ok || !data.ok || !data.photoUrl) {
      return { ok: false, error: data.error ?? genericError, ...(response.status >= 400 && response.status < 500 ? { rejected: true } : {}) };
    }
    return { ok: true, savedAt: data.savedAt ?? "", photoUrl: data.photoUrl };
  } catch {
    return { ok: false, error: genericError };
  }
}

export async function removeReplyPhoto(
  token: string,
  issueQuestionId: string,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const response = await fetcher(`/api/reply/${token}/photo`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueQuestionId }),
    });
    return await parseSaveResult(response, genericError);
  } catch {
    return { ok: false, error: genericError };
  }
}

/** The name shown next to this person's answers. Token-scoped, like everything else here. */
export async function saveReplyName(
  token: string,
  name: string,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  return postReply(token, { action: "name", name }, genericError, fetcher);
}

/** Turn the loop's automatic reminder on ("all") or off ("none") for this person. */
export async function saveReminderPreference(
  token: string,
  preference: "all" | "none",
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  return postReply(token, { action: "reminders", preference }, genericError, fetcher);
}

/** Keep writes for one question in request order, while allowing other questions to save independently. */
export function createSerialDraftWriter<T>(write: (questionId: string, body: string) => Promise<T>) {
  const pending = new Map<string, Promise<unknown>>();

  return (questionId: string, body: string): Promise<T> => {
    const previous = pending.get(questionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => write(questionId, body));
    pending.set(questionId, current);

    return current.finally(() => {
      if (pending.get(questionId) === current) pending.delete(questionId);
    });
  };
}

export type AudioSaveResult =
  | { ok: true; savedAt: string; audioUrl: string; audioDurationMs: number }
  | { ok: false; error: string; rejected?: boolean };

/** A recording or picked file goes straight to the app — it never needs the Blob client flow. */
export async function uploadReplyAudio(
  token: string,
  issueQuestionId: string,
  audio: Blob,
  filename: string,
  durationMs: number,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<AudioSaveResult> {
  try {
    const form = new FormData();
    form.set("issueQuestionId", issueQuestionId);
    form.set("audio", audio, filename);
    form.set("durationMs", String(Math.round(durationMs)));
    const response = await fetcher(`/api/reply/${token}/audio`, { method: "POST", body: form });
    const data = await readUploadResponse<{
      ok?: boolean;
      savedAt?: string;
      audioUrl?: string;
      audioDurationMs?: number;
      error?: string;
    }>(response, copy.reply.errors.voiceTooLarge);
    if (!response.ok || !data.ok || !data.audioUrl || typeof data.audioDurationMs !== "number") {
      return { ok: false, error: data.error ?? genericError, ...(response.status >= 400 && response.status < 500 ? { rejected: true } : {}) };
    }
    return {
      ok: true,
      savedAt: data.savedAt ?? "",
      audioUrl: data.audioUrl,
      audioDurationMs: data.audioDurationMs,
    };
  } catch {
    return { ok: false, error: genericError };
  }
}

export async function removeReplyAudio(
  token: string,
  issueQuestionId: string,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SaveResult> {
  try {
    const response = await fetcher(`/api/reply/${token}/audio`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueQuestionId }),
    });
    return await parseSaveResult(response, genericError);
  } catch {
    return { ok: false, error: genericError };
  }
}

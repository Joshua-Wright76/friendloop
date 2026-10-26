import { upload as uploadBlob } from "@vercel/blob/client";
import { copy } from "./copy.ts";
import { validatePhoto } from "./photo-validation.ts";

export type SaveResult = { ok: true; savedAt: string } | { ok: false; error: string };
export type PhotoSaveResult =
  | { ok: true; savedAt: string; photoUrl: string }
  | { ok: false; error: string };

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

export async function uploadReplyPhoto(
  token: string,
  issueQuestionId: string,
  file: File,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<PhotoSaveResult> {
  try {
    if (process.env.NODE_ENV === "production") {
      const inspected = validatePhoto(new Uint8Array(await file.arrayBuffer()), file.type);
      if (!inspected.ok) {
        return {
          ok: false,
          error: inspected.reason === "too-large"
            ? copy.reply.errors.photoTooLarge
            : copy.reply.errors.invalidPhoto,
        };
      }

      const randomName = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const blob = await uploadBlob(`reply-photos/${randomName}.${inspected.format.extension}`, file, {
        access: "public",
        contentType: inspected.format.contentType,
        handleUploadUrl: `/api/reply/${token}/photo`,
        clientPayload: JSON.stringify({ issueQuestionId }),
      });

      const deadline = Date.now() + 15_000;
      while (true) {
        const response = await fetcher(`/api/reply/${token}/photo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "checkBlob", issueQuestionId, photoUrl: blob.url }),
        });
        const data = (await response.json()) as {
          ok?: boolean;
          pending?: boolean;
          photoUrl?: string;
          error?: string;
        };
        if (response.ok && data.ok && data.photoUrl) {
          return { ok: true, savedAt: new Date().toISOString(), photoUrl: data.photoUrl };
        }
        if (!data.pending || Date.now() >= deadline) {
          return { ok: false, error: data.error ?? genericError };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    const form = new FormData();
    form.set("issueQuestionId", issueQuestionId);
    form.set("photo", file, file.name);
    const response = await fetcher(`/api/reply/${token}/photo`, { method: "POST", body: form });
    const data = (await response.json()) as {
      ok?: boolean;
      savedAt?: string;
      photoUrl?: string;
      error?: string;
    };
    if (!response.ok || !data.ok || !data.photoUrl) {
      return { ok: false, error: data.error ?? genericError };
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

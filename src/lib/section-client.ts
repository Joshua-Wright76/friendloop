import { copy } from "./copy.ts";
import { readUploadResponse } from "./upload-response.ts";

export type SectionPhotoSaveResult =
  | { ok: true; savedAt: string; mediaId: string; url: string }
  | { ok: false; error: string };

/** A photo-wall or standard-section photo posts straight to the app. */
export async function uploadReplySectionPhoto(
  token: string,
  issueSectionId: string,
  file: File,
  caption: string,
  position: number,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<SectionPhotoSaveResult> {
  try {
    const form = new FormData();
    form.set("issueSectionId", issueSectionId);
    form.set("photo", file, file.name);
    form.set("caption", caption);
    form.set("position", String(position));
    const response = await fetcher(`/api/reply/${token}/section-media`, { method: "POST", body: form });
    const data = await readUploadResponse<{
      ok?: boolean;
      savedAt?: string;
      mediaId?: string;
      url?: string;
      error?: string;
    }>(response, copy.reply.errors.photoTooLarge);
    if (!response.ok || !data.ok || !data.mediaId || !data.url) {
      return { ok: false, error: data.error ?? genericError };
    }
    return { ok: true, savedAt: data.savedAt ?? "", mediaId: data.mediaId, url: data.url };
  } catch {
    return { ok: false, error: genericError };
  }
}

export async function removeReplySectionMedia(
  token: string,
  issueSectionId: string,
  mediaId: string,
  genericError: string,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; savedAt: string } | { ok: false; error: string }> {
  try {
    const response = await fetcher(`/api/reply/${token}/section-media`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ issueSectionId, mediaId }),
    });
    const data = (await response.json()) as { ok?: boolean; savedAt?: string; error?: string };
    if (!response.ok || !data.ok) return { ok: false, error: data.error ?? genericError };
    return { ok: true, savedAt: data.savedAt ?? "" };
  } catch {
    return { ok: false, error: genericError };
  }
}

import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { appUrl, url } from "./urls.ts";
import type { AudioFormat } from "./audio-validation";

const LOCAL_UPLOAD_PATH = /^\/uploads\/([a-f0-9]{64}\.(?:webm|m4a|mp3|ogg))$/;
const BLOB_HOST = /^[a-z0-9-]+\.(?:public\.)?blob\.vercel-storage\.com$/i;

export function isManagedBlobAudioUrl(audioUrl: string): boolean {
  try {
    const parsed = new URL(audioUrl);
    return parsed.protocol === "https:" &&
      BLOB_HOST.test(parsed.hostname) &&
      /^\/reply-audio\/[a-f0-9]{64}\.(?:webm|m4a|mp3|ogg)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

/** Store validated audio locally in development and in public Vercel Blob in production. */
export async function storeAudio(bytes: Uint8Array, format: AudioFormat): Promise<string> {
  const filename = `${randomBytes(32).toString("hex")}.${format.extension}`;

  // The suite runs the production build (next start) without a Blob token, so
  // it stores audio on disk exactly like a dev server — same seam as the clock.
  if (process.env.NODE_ENV === "production" && process.env.E2E !== "1") {
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for production audio uploads.");

    const blob = await put(`reply-audio/${filename}`, new Blob([new Uint8Array(bytes)], { type: format.contentType }), {
      access: "public",
      addRandomSuffix: false,
      contentType: format.contentType,
      token,
    });
    return blob.url;
  }

  const uploadsDirectory = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDirectory, { recursive: true });
  await writeFile(path.join(uploadsDirectory, filename), bytes, { flag: "wx" });
  return url(`/uploads/${filename}`);
}

/** Delete only URLs owned by this storage layer. Call after the database stops referencing them. */
export async function deleteStoredAudio(audioUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(audioUrl, appUrl());
  } catch {
    return;
  }

  const appOrigin = new URL(appUrl()).origin;
  const localMatch = LOCAL_UPLOAD_PATH.exec(parsed.pathname);
  if (parsed.origin === appOrigin && localMatch) {
    const uploadsDirectory = path.join(process.cwd(), "public", "uploads");
    await unlink(path.join(uploadsDirectory, localMatch[1])).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (isManagedBlobAudioUrl(parsed.toString())) {
    if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required to remove production audio.");
    await del(parsed.toString(), { token });
  }
}

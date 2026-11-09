import { mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, head, list } from "@vercel/blob";
import { appUrl, url } from "./urls.ts";
import type { VideoFormat } from "./video-validation";

/*
 * Clips are too big for a function's 4.5 MB request limit, so in production the
 * browser sends them straight to public Vercel Blob (`/api/reply/[token]/video/upload`
 * signs the upload) and then tells the app where it landed. Development and the
 * suite have no Blob token: there the browser posts the clip to the app, which
 * keeps it on disk next to photos and voice notes.
 */

const BLOB_HOST = /^[a-z0-9-]+\.(?:public\.)?blob\.vercel-storage\.com$/i;
const LOCAL_UPLOAD_PATH = /^\/uploads\/([a-f0-9]{64}\.(?:mp4|mov|webm))$/;
/** The only names a browser may upload a clip under; the random part is 32 bytes. */
export const VIDEO_BLOB_PATHNAME = /^reply-videos\/[a-f0-9]{64}\.(?:mp4|mov|webm)$/;
/** How much of a clip the app reads to check what it is. */
const HEAD_BYTES = 32;

export type VideoUploadMode = "blob" | "local";

/** Same seam as photos and voice notes: the production build under the suite stores on disk. */
export function videoUploadMode(): VideoUploadMode {
  return process.env.NODE_ENV === "production" && process.env.E2E !== "1" ? "blob" : "local";
}

function blobToken(): string {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for video uploads.");
  return token;
}

export function isManagedBlobVideoUrl(videoUrl: string): boolean {
  try {
    const parsed = new URL(videoUrl);
    return parsed.protocol === "https:" &&
      BLOB_HOST.test(parsed.hostname) &&
      VIDEO_BLOB_PATHNAME.test(parsed.pathname.slice(1));
  } catch {
    return false;
  }
}

function localFileOf(videoUrl: string): string | null {
  try {
    const parsed = new URL(videoUrl, appUrl());
    if (parsed.origin !== new URL(appUrl()).origin) return null;
    return LOCAL_UPLOAD_PATH.exec(parsed.pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

function uploadsDirectory(): string {
  return path.join(process.cwd(), "public", "uploads");
}

/** Keep a clip the app received itself. Only ever in local mode. */
export async function storeVideoLocally(bytes: Uint8Array, format: VideoFormat, randomHex: string): Promise<string> {
  const filename = `${randomHex}.${format.extension}`;
  await mkdir(uploadsDirectory(), { recursive: true });
  await writeFile(path.join(uploadsDirectory(), filename), bytes, { flag: "wx" });
  return url(`/uploads/${filename}`);
}

export type StoredVideo = { size: number; contentType: string; head: Uint8Array };

/**
 * Size, type and first bytes of a clip this app owns, or null when the URL is
 * not one of ours or nothing is there. The app never saw a directly uploaded
 * clip's bytes, so this is how it checks one before an answer points at it.
 */
export async function readStoredVideo(videoUrl: string): Promise<StoredVideo | null> {
  if (isManagedBlobVideoUrl(videoUrl)) {
    const token = blobToken();
    const meta = await head(videoUrl, { token }).catch(() => null);
    if (!meta) return null;
    const response = await fetch(videoUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` }, cache: "no-store" });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer()).subarray(0, HEAD_BYTES);
    return { size: meta.size, contentType: meta.contentType, head: bytes };
  }

  const file = localFileOf(videoUrl);
  if (!file) return null;
  const handle = await open(path.join(uploadsDirectory(), file), "r").catch(() => null);
  if (!handle) return null;
  try {
    const { size } = await handle.stat();
    const buffer = new Uint8Array(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return { size, contentType: "", head: buffer.subarray(0, bytesRead) };
  } finally {
    await handle.close();
  }
}

/** Delete only URLs owned by this storage layer. Call after the database stops referencing them. */
export async function deleteStoredVideo(videoUrl: string): Promise<void> {
  const file = localFileOf(videoUrl);
  if (file) {
    await unlink(path.join(uploadsDirectory(), file)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }

  if (isManagedBlobVideoUrl(videoUrl)) {
    await del(videoUrl, { token: blobToken() });
  }
}

/**
 * Clips uploaded before `before`. A browser closed between uploading a clip and
 * attaching it leaves one behind that no answer points at; the sweep checks each
 * of these and removes the ones nothing uses.
 */
export async function listStoredVideos(before: Date, limit: number): Promise<string[]> {
  if (videoUploadMode() !== "blob") return [];
  const token = blobToken();
  const found: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: "reply-videos/", cursor, limit: 1000, token });
    for (const blob of page.blobs) {
      if (blob.uploadedAt < before) found.push(blob.url);
      if (found.length >= limit) return found;
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return found;
}

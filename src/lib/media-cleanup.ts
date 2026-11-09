import { asc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { comments, groups, mediaDeletions, memberships, replies, replyMedia, sectionMedia } from "@/db/schema";
import { deleteStoredAudio } from "./media-storage.ts";
import { deleteStoredPhoto } from "./photo-storage.ts";
import { deleteStoredVideo, listStoredVideos } from "./video-storage.ts";

/** The database, or a transaction on it: queueing has to ride in the caller's. */
export type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A file that has failed this many times is left queued for a person to look at. */
export const MAX_MEDIA_ATTEMPTS = 10;
const IMMEDIATE_TRIES = 3;
const SWEEP_BATCH = 100;

/**
 * Record files to remove. Call inside the transaction that drops the rows
 * pointing at them, so the rows and the promise to remove the files commit or
 * roll back together. Returns the URLs it queued.
 */
export async function queueMediaDeletion(
  executor: Executor,
  urls: Iterable<string | null | undefined>,
): Promise<string[]> {
  const unique = [...new Set([...urls].filter((url): url is string => typeof url === "string" && url.length > 0))];
  if (unique.length === 0) return [];
  await executor
    .insert(mediaDeletions)
    .values(unique.map((url) => ({ url })))
    .onConflictDoNothing({ target: mediaDeletions.url });
  return unique;
}

/** Whether any row still shows this file; a shared file is never pulled out from under it. */
export async function isMediaReferenced(url: string): Promise<boolean> {
  const checks = [
    db.select({ id: replies.id }).from(replies).where(or(
      eq(replies.photoUrl, url),
      eq(replies.audioUrl, url),
      eq(replies.videoUrl, url),
      eq(replies.videoPosterUrl, url),
    )).limit(1),
    db.select({ id: comments.id }).from(comments).where(eq(comments.photoUrl, url)).limit(1),
    db.select({ id: replyMedia.id }).from(replyMedia).where(or(eq(replyMedia.url, url), eq(replyMedia.videoUrl, url))).limit(1),
    // The legacy copy until the contract release drops it: a rollback would show it.
    db.select({ id: sectionMedia.id }).from(sectionMedia).where(eq(sectionMedia.url, url)).limit(1),
    db.select({ id: memberships.id }).from(memberships).where(or(eq(memberships.photoUrl, url), eq(memberships.signaturePngUrl, url))).limit(1),
    db.select({ id: groups.id }).from(groups).where(eq(groups.headerImageUrl, url)).limit(1),
  ];
  for (const check of checks) {
    if ((await check).length > 0) return true;
  }
  return false;
}

/**
 * Remove one stored file. Each storage layer only touches URLs it owns, so a
 * photo URL is a no-op for the audio and video layers and the other way round,
 * and a URL this app never stored is left alone by all of them.
 */
export async function removeStoredFile(url: string): Promise<void> {
  await deleteStoredPhoto(url);
  await deleteStoredAudio(url);
  await deleteStoredVideo(url);
}

async function purgeOne(url: string, tries: number): Promise<boolean> {
  if (await isMediaReferenced(url)) {
    await db.delete(mediaDeletions).where(eq(mediaDeletions.url, url));
    return true;
  }

  let lastError: unknown = null;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      await removeStoredFile(url);
      await db.delete(mediaDeletions).where(eq(mediaDeletions.url, url));
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  await db
    .update(mediaDeletions)
    .set({
      attempts: sql`${mediaDeletions.attempts} + ${tries}`,
      lastError: lastError instanceof Error ? lastError.message : String(lastError),
      lastAttemptAt: sql`now()`,
    })
    .where(eq(mediaDeletions.url, url));
  console.error("Unable to remove a stored file; the sweep will try again", lastError);
  return false;
}

/** Try each queued file now. Returns how many are gone (or turned out to be still in use). */
export async function purgeMedia(urls: string[], tries = IMMEDIATE_TRIES): Promise<number> {
  let purged = 0;
  for (const url of urls) {
    if (await purgeOne(url, tries)) purged += 1;
  }
  return purged;
}

/** The sweep's pass over whatever an earlier deletion could not finish. */
export async function purgeQueuedMedia(limit = SWEEP_BATCH): Promise<number> {
  const queued = await db
    .select({ url: mediaDeletions.url })
    .from(mediaDeletions)
    .where(lt(mediaDeletions.attempts, MAX_MEDIA_ATTEMPTS))
    .orderBy(asc(mediaDeletions.createdAt))
    .limit(limit);
  return purgeMedia(queued.map((row) => row.url), 1);
}

/** A clip still unattached after this long was left by a browser that closed mid-answer. */
export const ORPHAN_VIDEO_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Remove clips uploaded straight to storage that no answer ever came to point
 * at. Listing the store is a paid operation, so the sweep calls this hourly
 * rather than every run. Returns how many it removed.
 */
export async function purgeOrphanVideos(at: Date, limit = SWEEP_BATCH): Promise<number> {
  let candidates: string[];
  try {
    candidates = await listStoredVideos(new Date(at.getTime() - ORPHAN_VIDEO_AGE_MS), limit);
  } catch (error) {
    console.error("Unable to list stored videos; the sweep will try again", error);
    return 0;
  }
  let removed = 0;
  for (const url of candidates) {
    if (await isMediaReferenced(url)) continue;
    try {
      await deleteStoredVideo(url);
      removed += 1;
    } catch (error) {
      console.error("Unable to remove an unattached video; the sweep will try again", error);
    }
  }
  return removed;
}

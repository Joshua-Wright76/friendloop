import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { uploadRefused, videoUploadRefused } from "@/lib/upload-limit";
import {
  authorizeVideoForReply,
  deletePhotoIfUnreferenced,
  deleteVideoIfUnreferenced,
  removeVideoFor,
  saveVideoFor,
  saveWallVideoFor,
} from "@/lib/reply";
import { storePhoto } from "@/lib/photo-storage";
import { MAX_PHOTO_BYTES, validatePhoto } from "@/lib/photo-validation";
import { isManagedBlobVideoUrl, readStoredVideo, storeVideoLocally, videoUploadMode } from "@/lib/video-storage";
import { checkVideoDuration, MAX_VIDEO_BYTES, validateVideo } from "@/lib/video-validation";
import { copy } from "@/lib/copy";
import { log } from "@/lib/log";

type RouteContext = { params: Promise<{ token: string }> };

const errors = copy.reply.errors;

function refuse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

async function cleanup(videoUrl: string | undefined, posterUrl: string | undefined) {
  if (videoUrl) await deleteVideoIfUnreferenced(videoUrl).catch((error: unknown) => log.error("Unable to clean up reply video", error));
  if (posterUrl) await deletePhotoIfUnreferenced(posterUrl).catch((error: unknown) => log.error("Unable to clean up video still", error));
}

/**
 * Attach a clip to an answer or a photo wall, with the still image the browser
 * took from it. In production the clip is already in Blob (uploaded through
 * `./upload`), and this names it by `videoUrl`; locally the clip comes in the
 * same form as `video`. Either way its first bytes and size are checked here
 * before anything points at it.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const refused = await uploadRefused(token, errors.tooManyUploads);
  if (refused) return refused;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(errors.missingVideo, 400);
  }

  const issueQuestionId = form.get("issueQuestionId");
  const poster = form.get("poster");
  const video = form.get("video");
  const sentUrl = form.get("videoUrl");
  const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : "";
  const position = Number(form.get("position") ?? 0);
  if (typeof issueQuestionId !== "string" || !issueQuestionId) return refuse(errors.missingQuestion, 400);
  const durationMs = checkVideoDuration(form.get("durationMs"));
  if (durationMs === null) return refuse(errors.videoTooLong, 413);
  if (!(poster instanceof File)) return refuse(errors.missingVideo, 400);
  if (poster.size > MAX_PHOTO_BYTES) return refuse(errors.videoUploadFailed, 413);

  const mode = videoUploadMode();
  if (mode === "local" ? !(video instanceof File) : typeof sentUrl !== "string" || !isManagedBlobVideoUrl(sentUrl)) {
    return refuse(errors.missingVideo, 400);
  }
  // In production the clip's own cap was spent when its upload was signed.
  if (mode === "local" && (await videoUploadRefused(token))) return refuse(errors.tooManyUploads, 429);

  const authorization = await authorizeVideoForReply(token, issueQuestionId);
  if (!authorization.ok) {
    // A clip that went to Blob for a question it can't go on is nobody's.
    if (typeof sentUrl === "string" && mode === "blob") await cleanup(sentUrl, undefined);
    return refuse(authorization.error, authorization.status);
  }

  const posterBytes = new Uint8Array(await poster.arrayBuffer());
  const posterCheck = validatePhoto(posterBytes, poster.type);
  if (!posterCheck.ok) return refuse(errors.videoUploadFailed, 415);

  let videoUrl: string | undefined;
  let posterUrl: string | undefined;
  try {
    if (video instanceof File && mode === "local") {
      if (video.size > MAX_VIDEO_BYTES) return refuse(errors.videoTooLarge, 413);
      const bytes = new Uint8Array(await video.arrayBuffer());
      const check = validateVideo(bytes.subarray(0, 32), bytes.byteLength, video.type);
      if (!check.ok) return refuse(check.reason === "too-large" ? errors.videoTooLarge : errors.invalidVideo, check.reason === "too-large" ? 413 : 415);
      videoUrl = await storeVideoLocally(bytes, check.format, randomBytes(32).toString("hex"));
    } else {
      videoUrl = String(sentUrl);
      const stored = await readStoredVideo(videoUrl);
      if (!stored) return refuse(errors.videoUploadFailed, 400);
      const check = validateVideo(stored.head, stored.size, stored.contentType);
      if (!check.ok) {
        await cleanup(videoUrl, undefined);
        return refuse(check.reason === "too-large" ? errors.videoTooLarge : errors.invalidVideo, check.reason === "too-large" ? 413 : 415);
      }
    }

    posterUrl = await storePhoto(posterBytes, posterCheck.format);
    const input = { token, issueQuestionId, videoUrl, posterUrl, durationMs };
    const result = authorization.format === "photo_wall"
      ? await saveWallVideoFor({ ...input, caption, position })
      : await saveVideoFor(input);
    if (!result.ok) {
      await cleanup(videoUrl, posterUrl);
      return refuse(result.error, result.status);
    }
    return NextResponse.json({ ...result, ok: true });
  } catch (error) {
    await cleanup(videoUrl, posterUrl);
    log.error("Unable to save reply video", error);
    return refuse(errors.videoUploadFailed, 500);
  }
}

/** Take the clip off a written answer. A photo wall's clips come off through `/media`, like its photos. */
export async function DELETE(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let payload: { issueQuestionId?: string };
  try {
    payload = await request.json();
  } catch {
    return refuse(errors.json, 400);
  }
  if (typeof payload.issueQuestionId !== "string" || !payload.issueQuestionId) {
    return refuse(errors.missingQuestion, 400);
  }

  const result = await removeVideoFor({ token, issueQuestionId: payload.issueQuestionId });
  return result.ok
    ? NextResponse.json({ ok: true, savedAt: result.savedAt })
    : refuse(result.error, result.status);
}

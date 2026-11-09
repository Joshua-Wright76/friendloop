/**
 * Make a phone video fit before it leaves the device.
 *
 * A minute straight off a phone is 60–350 MB, often HEVC that half the browsers
 * reading the issue can't play. So the browser re-encodes it: H.264 MP4 at 720p
 * (about 15–20 MB a minute), keeping the first minute of anything longer, and
 * takes a still from it to stand in wherever a clip can't play (email, print,
 * the album grid). The work runs on the browser's own encoder through WebCodecs
 * (Mediabunny), loaded only when someone actually picks a video.
 *
 * A browser that can't re-encode sends the clip as it is, if it is already short
 * and small enough; the server checks the bytes either way.
 */

import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_MS, VIDEO_DURATION_GRACE_MS } from "@/lib/video-validation";

export type PreparedVideo =
  | {
      ok: true;
      video: Blob;
      contentType: "video/mp4" | "video/quicktime" | "video/webm";
      extension: "mp4" | "mov" | "webm";
      poster: File;
      durationMs: number;
      /** It ran over the cap and keeps its first minute. */
      trimmed: boolean;
    }
  | { ok: false; reason: "unreadable" | "too-long" | "too-large" | "cancelled" };

/** The long side of a re-encoded clip: 1280×720 landscape, 720×1280 portrait. */
const MAX_EDGE = 1280;
const POSTER_EDGE = 960;
const MAX_SECONDS = MAX_VIDEO_DURATION_MS / 1000;

type Progress = (fraction: number) => void;

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob | null> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 }).catch(() => null);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
}

function posterFile(blob: Blob): File {
  return new File([blob], "video-still.jpg", { type: "image/jpeg" });
}

/** What a plain <video> element can tell about a clip: its length, and a frame. Used when WebCodecs can't read it. */
async function readWithElement(file: Blob): Promise<{ durationMs: number; poster: Blob | null } | null> {
  const url = URL.createObjectURL(file);
  const element = document.createElement("video");
  element.muted = true;
  element.playsInline = true;
  element.preload = "auto";
  element.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      element.onloadedmetadata = () => resolve();
      element.onerror = () => reject(new Error("unreadable"));
      setTimeout(() => reject(new Error("timeout")), 15_000);
    });
    const durationMs = Number.isFinite(element.duration) ? element.duration * 1000 : 0;
    let poster: Blob | null = null;
    try {
      element.currentTime = Math.min(0.5, element.duration / 2 || 0);
      await new Promise<void>((resolve, reject) => {
        element.onseeked = () => resolve();
        setTimeout(() => reject(new Error("timeout")), 8_000);
      });
      const scale = Math.min(1, POSTER_EDGE / Math.max(element.videoWidth, element.videoHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = even(element.videoWidth * scale);
      canvas.height = even(element.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
      if (element.videoWidth > 0) poster = await canvasToJpeg(canvas);
    } catch {
      poster = null;
    }
    return { durationMs, poster };
  } catch {
    return null;
  } finally {
    element.removeAttribute("src");
    element.load();
    URL.revokeObjectURL(url);
  }
}

/** A plain still with a play mark, for a clip no part of the browser could draw a frame from. */
async function placeholderPoster(): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#3d2a30";
  context.fillRect(0, 0, 640, 360);
  context.fillStyle = "#ffffff";
  context.beginPath();
  context.moveTo(290, 140);
  context.lineTo(290, 220);
  context.lineTo(360, 180);
  context.closePath();
  context.fill();
  return canvasToJpeg(canvas);
}

function containerOf(file: Blob): { contentType: "video/mp4" | "video/quicktime" | "video/webm"; extension: "mp4" | "mov" | "webm" } | null {
  const type = file.type.toLowerCase();
  if (type === "video/mp4" || type === "video/x-m4v") return { contentType: "video/mp4", extension: "mp4" };
  if (type === "video/quicktime") return { contentType: "video/quicktime", extension: "mov" };
  if (type === "video/webm") return { contentType: "video/webm", extension: "webm" };
  return null;
}

/** Send the clip as it came, when it already fits. */
async function asItIs(file: Blob, knownDurationMs: number | null, poster: Blob | null): Promise<PreparedVideo> {
  const container = containerOf(file);
  if (!container) return { ok: false, reason: "unreadable" };
  const read = knownDurationMs && poster ? { durationMs: knownDurationMs, poster } : await readWithElement(file);
  const durationMs = knownDurationMs ?? read?.durationMs ?? 0;
  if (durationMs <= 0) return { ok: false, reason: "unreadable" };
  if (durationMs > MAX_VIDEO_DURATION_MS + VIDEO_DURATION_GRACE_MS) return { ok: false, reason: "too-long" };
  if (file.size > MAX_VIDEO_BYTES) return { ok: false, reason: "too-large" };
  const still = poster ?? read?.poster ?? (await placeholderPoster());
  if (!still) return { ok: false, reason: "unreadable" };
  return { ok: true, video: file, ...container, poster: posterFile(still), durationMs: Math.round(durationMs), trimmed: false };
}

/**
 * Re-encode `file` for sending. `onProgress` gets 0–1 while it works. Abort
 * `signal` to stop; the result is then `cancelled`.
 */
export async function prepareVideo(file: Blob, onProgress: Progress = () => {}, signal?: AbortSignal): Promise<PreparedVideo> {
  let media: typeof import("mediabunny");
  try {
    media = await import("mediabunny");
  } catch {
    return asItIs(file, null, null);
  }

  const input = new media.Input({ source: new media.BlobSource(file), formats: media.ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack().catch(() => null);
    if (!track) return asItIs(file, null, null);

    const start = await input.getFirstTimestamp().catch(() => 0);
    const end = await input.computeDuration().catch(() => 0);
    const seconds = Math.max(0, end - start);
    if (seconds <= 0) return asItIs(file, null, null);
    const trimmed = seconds * 1000 > MAX_VIDEO_DURATION_MS + VIDEO_DURATION_GRACE_MS;
    const keptSeconds = Math.min(seconds, MAX_SECONDS);

    // The still first: if this browser can decode the clip, a real frame is always better than a blank.
    let poster: Blob | null = null;
    if (await track.canDecode().catch(() => false)) {
      try {
        const landscape = track.displayWidth >= track.displayHeight;
        const sink = new media.CanvasSink(track, landscape
          ? { width: even(Math.min(POSTER_EDGE, track.displayWidth)), poolSize: 1 }
          : { height: even(Math.min(POSTER_EDGE, track.displayHeight)), poolSize: 1 });
        const frame = await sink.getCanvas(start + Math.min(0.5, keptSeconds / 2));
        if (frame) poster = await canvasToJpeg(frame.canvas);
      } catch {
        poster = null;
      }
    }
    if (signal?.aborted) return { ok: false, reason: "cancelled" };

    const landscape = track.displayWidth >= track.displayHeight;
    const long = Math.max(track.displayWidth, track.displayHeight);
    const size = long > MAX_EDGE
      ? landscape ? { width: even(MAX_EDGE) } : { height: even(MAX_EDGE) }
      : {};

    const output = new media.Output({
      format: new media.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new media.BufferTarget(),
    });
    const conversion = await media.Conversion.init({
      input,
      output,
      video: { ...size, codec: "avc", quality: media.QUALITY_MEDIUM, hardwareAcceleration: "prefer-hardware" },
      audio: { quality: media.QUALITY_MEDIUM },
      trim: trimmed ? { start, end: start + MAX_SECONDS } : undefined,
      showWarnings: false,
    }).catch(() => null);

    const keepsVideo = conversion?.isValid && !conversion.discardedTracks.some((entry) => entry.track.type === "video");
    if (!conversion || !keepsVideo) return asItIs(file, trimmed ? null : Math.round(seconds * 1000), poster);

    const abort = () => void conversion.cancel();
    signal?.addEventListener("abort", abort, { once: true });
    conversion.onProgress = (fraction) => onProgress(Math.max(0, Math.min(1, fraction)));
    try {
      await conversion.execute();
    } catch {
      if (signal?.aborted) return { ok: false, reason: "cancelled" };
      return asItIs(file, trimmed ? null : Math.round(seconds * 1000), poster);
    } finally {
      signal?.removeEventListener("abort", abort);
    }

    const buffer = output.target.buffer;
    if (!buffer) return asItIs(file, trimmed ? null : Math.round(seconds * 1000), poster);
    const video = new Blob([buffer], { type: "video/mp4" });
    // A clip already small and efficient can come out bigger re-encoded; send whichever is smaller.
    const chosen = !trimmed && containerOf(file)?.contentType === "video/mp4" && file.size < video.size ? file : video;
    if (chosen.size > MAX_VIDEO_BYTES) return { ok: false, reason: "too-large" };

    const still = poster ?? (await readWithElement(video))?.poster ?? (await placeholderPoster());
    if (!still) return { ok: false, reason: "unreadable" };
    return {
      ok: true,
      video: chosen,
      contentType: "video/mp4",
      extension: "mp4",
      poster: posterFile(still),
      durationMs: Math.round(keptSeconds * 1000),
      trimmed,
    };
  } finally {
    input.dispose();
  }
}

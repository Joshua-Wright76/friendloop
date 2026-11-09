/**
 * Video clips. The browser shrinks a clip to 720p MP4 before sending it
 * (`src/components/prepare-video.ts`), which puts a minute at roughly 15–20 MB.
 * A browser that can't shrink sends the original, so the cap leaves room for
 * a short phone clip as it came off the camera.
 */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_DURATION_MS = 60_000;
/** Containers round their length up a little; a "1:00" clip can read 60.4 s. */
export const VIDEO_DURATION_GRACE_MS = 1_500;
/** A photo wall holds six items per person; at most this many of them can be videos. */
export const WALL_VIDEO_MAX = 2;
export const VIDEO_ACCEPT = "video/*";

export type VideoFormat = {
  contentType: "video/mp4" | "video/quicktime" | "video/webm";
  extension: "mp4" | "mov" | "webm";
};

export const VIDEO_FORMATS: VideoFormat[] = [
  { contentType: "video/mp4", extension: "mp4" },
  { contentType: "video/quicktime", extension: "mov" },
  { contentType: "video/webm", extension: "webm" },
];

export const VIDEO_CONTENT_TYPES = VIDEO_FORMATS.map((format) => format.contentType);

export type VideoValidation =
  | { ok: true; format: VideoFormat }
  | { ok: false; reason: "too-large" | "unsupported" | "type-mismatch" };

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Which container the first bytes are, or null. Needs the first 12 bytes. */
export function sniffVideo(bytes: Uint8Array): VideoFormat | null {
  // EBML header every matroska/webm file starts with.
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return VIDEO_FORMATS[2];
  }
  // An ISO base media box: size (4 bytes), "ftyp", then the major brand.
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    return ascii(bytes, 8, 12) === "qt  " ? VIDEO_FORMATS[1] : VIDEO_FORMATS[0];
  }
  return null;
}

function normalize(contentType: string | undefined): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/**
 * Check the first bytes of a clip and its size. When the browser named a type
 * it has to agree with the bytes, except that MP4 and QuickTime share a box
 * format and phones label them loosely.
 */
export function validateVideo(head: Uint8Array, size: number, declaredContentType?: string): VideoValidation {
  if (size > MAX_VIDEO_BYTES) return { ok: false, reason: "too-large" };

  const format = sniffVideo(head);
  if (!format) return { ok: false, reason: "unsupported" };

  const declared = normalize(declaredContentType);
  const families: Record<VideoFormat["contentType"], string[]> = {
    "video/mp4": ["video/mp4", "video/quicktime", "video/x-m4v", "application/octet-stream"],
    "video/quicktime": ["video/quicktime", "video/mp4", "application/octet-stream"],
    "video/webm": ["video/webm", "application/octet-stream"],
  };
  if (declared && !families[format.contentType].includes(declared)) {
    return { ok: false, reason: "type-mismatch" };
  }

  return { ok: true, format };
}

/** A duration the browser reported, or null when it is missing or past the cap. */
export function checkVideoDuration(raw: unknown): number | null {
  const durationMs = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : Number.NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  if (durationMs > MAX_VIDEO_DURATION_MS + VIDEO_DURATION_GRACE_MS) return null;
  return Math.min(Math.round(durationMs), MAX_VIDEO_DURATION_MS);
}

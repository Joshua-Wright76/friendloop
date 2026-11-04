import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES, MAX_PHOTO_BYTES } from "./photo-validation.ts";

/**
 * Phone cameras produce 12–50 MP photos that are routinely 5–15 MB, far over
 * what a Vercel function accepts (~4.5 MB request body). Before uploading,
 * the browser decodes the picture, scales it to a sensible long edge, and
 * re-encodes it, so a typical photo lands at a few hundred kilobytes.
 */
export type ImageProfile = {
  /** Longest side, in pixels, of the uploaded picture. */
  maxEdge: number;
  /** Matches the server cap for the route the picture goes to. */
  maxBytes: number;
  /** Encoder quality for JPEG/WebP output, 0–1. */
  quality: number;
};

export const PHOTO_PROFILE: ImageProfile = { maxEdge: 2560, maxBytes: MAX_PHOTO_BYTES, quality: 0.85 };
export const BANNER_PROFILE: ImageProfile = { maxEdge: 2560, maxBytes: MAX_BANNER_BYTES, quality: 0.85 };
/** A profile picture is shown at a few dozen pixels. */
export const AVATAR_PROFILE: ImageProfile = { maxEdge: 512, maxBytes: MAX_AVATAR_BYTES, quality: 0.85 };

export type PreparedImage =
  | { ok: true; file: File; resized: boolean }
  | { ok: false; reason: "too-large" | "unsupported" };

export type DecodedImage = {
  width: number;
  height: number;
  source: CanvasImageSource;
  close: () => void;
};

/** The browser-specific half, swappable in tests. */
export type ImageCodec = {
  decode: (file: Blob) => Promise<DecodedImage | null>;
  encode: (
    image: DecodedImage,
    width: number,
    height: number,
    type: "image/jpeg" | "image/webp",
    quality: number,
  ) => Promise<Blob | null>;
};

/** Scale (width, height) down so the long edge is at most `maxEdge`; never scales up. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge || longEdge <= 0) return { width, height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

type Kind = "raster" | "gif" | "heic" | "unknown" | "unsupported";

const RASTER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** What the picker handed us, judged by MIME first and the file name when the MIME is missing. */
export function imageKind(file: { name: string; type: string }): Kind {
  const type = file.type.trim().toLowerCase();
  const extension = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (type === "image/gif") return "gif";
  if (RASTER_TYPES.has(type)) return "raster";
  if (type === "image/heic" || type === "image/heif" || extension === "heic" || extension === "heif") return "heic";
  if (!type) return "unknown";
  return "unsupported";
}

/** "IMG_1234.HEIC" → "IMG_1234.jpg". */
export function renameFor(name: string, type: string): string {
  const extension = type === "image/webp" ? "webp" : "jpg";
  const stem = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${stem}.${extension}`;
}

/** Each try trades a little more quality, then size, until the picture fits. */
export function encodeAttempts(profile: ImageProfile): { maxEdge: number; quality: number }[] {
  const lower = Math.min(profile.quality, 0.7);
  return [
    { maxEdge: profile.maxEdge, quality: profile.quality },
    { maxEdge: profile.maxEdge, quality: lower },
    { maxEdge: Math.round(profile.maxEdge * 0.75), quality: lower },
    { maxEdge: Math.round(profile.maxEdge * 0.5), quality: lower },
  ];
}

function paint(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  image: DecodedImage,
  width: number,
  height: number,
  type: string,
) {
  if (type === "image/jpeg") {
    // JPEG has no alpha; a transparent PNG would otherwise come out black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = "high";
  context.drawImage(image.source, 0, 0, width, height);
}

export const browserCodec: ImageCodec = {
  async decode(file) {
    if (typeof createImageBitmap !== "function") return null;
    let bitmap: ImageBitmap;
    try {
      // Honour the camera's EXIF rotation so portrait photos stay upright.
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older engines reject the option value; their default already follows EXIF.
      bitmap = await createImageBitmap(file);
    }
    return { width: bitmap.width, height: bitmap.height, source: bitmap, close: () => bitmap.close() };
  },
  async encode(image, width, height, type, quality) {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d");
      if (!context) return null;
      paint(context, image, width, height, type);
      return canvas.convertToBlob({ type, quality });
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    paint(context, image, width, height, type);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  },
};

async function decodeSafely(codec: ImageCodec, file: File): Promise<DecodedImage | null> {
  try {
    return await codec.decode(file);
  } catch {
    return null;
  }
}

/**
 * Make a picked picture fit the upload limit. GIFs (often animated) and
 * pictures already within both limits go up untouched; anything bigger is
 * scaled and re-encoded. HEIC converts when the browser can read it.
 */
export async function prepareImage(
  file: File,
  profile: ImageProfile,
  codec: ImageCodec = browserCodec,
): Promise<PreparedImage> {
  const kind = imageKind(file);
  if (kind === "unsupported") return { ok: false, reason: "unsupported" };
  if (kind === "gif") {
    return file.size <= profile.maxBytes ? { ok: true, file, resized: false } : { ok: false, reason: "too-large" };
  }

  const image = await decodeSafely(codec, file);
  if (!image) {
    if (kind === "heic") return { ok: false, reason: "unsupported" };
    // Not readable here; the server still checks the bytes, so only block what can't fit.
    return file.size <= profile.maxBytes ? { ok: true, file, resized: false } : { ok: false, reason: "too-large" };
  }

  try {
    const withinEdge = Math.max(image.width, image.height) <= profile.maxEdge;
    if (kind === "raster" && withinEdge && file.size <= profile.maxBytes) {
      return { ok: true, file, resized: false };
    }

    // WebP keeps a PNG's transparency; browsers that can't encode it hand back PNG, so fall back to JPEG.
    let type: "image/jpeg" | "image/webp" = file.type === "image/png" || file.type === "image/webp"
      ? "image/webp"
      : "image/jpeg";
    for (const attempt of encodeAttempts(profile)) {
      const size = fitWithin(image.width, image.height, attempt.maxEdge);
      let blob = await codec.encode(image, size.width, size.height, type, attempt.quality);
      if (blob && type === "image/webp" && blob.type !== "image/webp") {
        type = "image/jpeg";
        blob = await codec.encode(image, size.width, size.height, type, attempt.quality);
      }
      if (!blob) break;
      if (blob.size <= profile.maxBytes) {
        return { ok: true, file: new File([blob], renameFor(file.name, type), { type }), resized: true };
      }
    }
    return { ok: false, reason: "too-large" };
  } finally {
    image.close();
  }
}

/**
 * A 413 from the platform arrives before the app runs, as plain text rather
 * than JSON — read the body defensively and name the size problem plainly.
 */
export async function uploadErrorFrom(response: Response, tooLarge: string, generic: string): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (typeof data.error === "string" && data.error) return data.error;
  return response.status === 413 ? tooLarge : generic;
}

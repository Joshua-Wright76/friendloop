/**
 * Pictures ride multipart requests to Vercel functions, which refuse bodies
 * over 4.5 MB before the app runs. 4 MiB (4,194,304 bytes) leaves room for the
 * multipart envelope and the other form fields. Browsers downscale photos
 * before upload (see image-resize.ts), so real photos land well under this.
 */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
/** A profile picture is shown at a few dozen pixels; this is plenty. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
/** The loop's header picture: same platform limit as answer photos. */
export const MAX_BANNER_BYTES = 4 * 1024 * 1024;
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export type PhotoFormat = {
  contentType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  extension: "jpg" | "png" | "webp" | "gif";
};

export type PhotoValidation =
  | { ok: true; format: PhotoFormat }
  | { ok: false; reason: "too-large" | "unsupported" | "type-mismatch" };

const FORMATS: PhotoFormat[] = [
  { contentType: "image/jpeg", extension: "jpg" },
  { contentType: "image/png", extension: "png" },
  { contentType: "image/webp", extension: "webp" },
  { contentType: "image/gif", extension: "gif" },
];

function matches(bytes: Uint8Array, format: PhotoFormat): boolean {
  if (format.contentType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (format.contentType === "image/png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  }

  if (format.contentType === "image/gif") {
    if (bytes.length < 6) return false;
    const signature = String.fromCharCode(...bytes.subarray(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  }

  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
}

/** Validate the content itself and, when provided, require the browser MIME to agree. */
export function validatePhoto(bytes: Uint8Array, declaredContentType?: string): PhotoValidation {
  if (bytes.byteLength > MAX_PHOTO_BYTES) return { ok: false, reason: "too-large" };

  const format = FORMATS.find((candidate) => matches(bytes, candidate));
  if (!format) return { ok: false, reason: "unsupported" };

  const declared = declaredContentType?.trim().toLowerCase();
  if (declared && declared !== format.contentType) return { ok: false, reason: "type-mismatch" };

  return { ok: true, format };
}

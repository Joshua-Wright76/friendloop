/**
 * Make a camera-roll photo fit before it leaves the device.
 *
 * Phone photos are routinely 3–12 MB and often HEIC or sideways. The server
 * (and Vercel, which refuses request bodies over 4.5 MB) can't take most of
 * them, and "your photo is too big" is not something a person can act on. So the
 * browser does the shrinking: it decodes the picture (honouring the camera's
 * rotation), scales the long edge down, and re-encodes it as a JPEG until it
 * fits. A picture that already fits is sent untouched.
 */

export type ImageTarget = {
  /** The encoded file must come in at or under this many bytes. */
  maxBytes: number;
  /** The longest side, in pixels. Anything larger is scaled down. */
  maxEdge: number;
};

/** Answers, section photos and comment photos: shown large, kept well under Vercel's 4.5 MB. */
export const PHOTO_TARGET: ImageTarget = { maxBytes: 3.5 * 1024 * 1024, maxEdge: 2560 };
/** A profile picture is shown at a few dozen pixels. */
export const AVATAR_TARGET: ImageTarget = { maxBytes: 1024 * 1024, maxEdge: 512 };
/** The header picture spans the top of a page. */
export const BANNER_TARGET: ImageTarget = { maxBytes: 3 * 1024 * 1024, maxEdge: 2400 };

export type PreparedImage = { ok: true; file: File } | { ok: false };

const PASS_THROUGH = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

async function decode(file: File): Promise<Decoded | null> {
  try {
    if (typeof createImageBitmap === "function") {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    }
  } catch {
    // Fall through to an <img>, which some browsers can read when the bitmap path cannot.
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "") || "photo";
  return `${base}.jpg`;
}

export async function prepareImage(file: File, target: ImageTarget): Promise<PreparedImage> {
  const fits = file.size <= target.maxBytes;
  const supported = PASS_THROUGH.has(file.type);

  // An animated GIF would be flattened by a redraw, so one that fits is left alone.
  if (file.type === "image/gif" && fits) return { ok: true, file };

  const decoded = await decode(file);
  if (!decoded) {
    // Not something this browser can read (HEIC outside Safari, say). Send a small,
    // known type as it is and let the server be the judge; otherwise say so.
    return fits && supported ? { ok: true, file } : { ok: false };
  }

  try {
    const longest = Math.max(decoded.width, decoded.height);
    if (fits && supported && longest <= target.maxEdge) return { ok: true, file };

    let scale = Math.min(1, target.maxEdge / longest);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return fits && supported ? { ok: true, file } : { ok: false };
      // JPEG has no transparency: lay the picture on white rather than black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

      for (const quality of [0.88, 0.8, 0.7, 0.6]) {
        const blob = await encode(canvas, quality);
        if (blob && blob.size <= target.maxBytes) {
          return { ok: true, file: new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified }) };
        }
      }
      scale *= 0.8;
    }
    return { ok: false };
  } finally {
    decoded.release();
  }
}

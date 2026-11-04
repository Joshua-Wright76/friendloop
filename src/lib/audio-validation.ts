/**
 * Under Vercel's ~4.5 MB function body limit with room for the multipart
 * envelope. The recorder asks for 64 kbps: 180 s × 64 kbit/s ≈ 1.44 MB, and
 * even a 128 kbps engine default is ≈ 2.9 MB. Picked files over this are
 * refused in the browser before upload.
 */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
export const MAX_AUDIO_DURATION_MS = 180_000;
export const AUDIO_ACCEPT = ".webm,.m4a,.mp3,.mp4,.ogg,.oga,.opus";

export type AudioFormat = {
  contentType: "audio/webm" | "audio/mp4" | "audio/mpeg" | "audio/ogg";
  extension: "webm" | "m4a" | "mp3" | "ogg";
};

export type AudioValidation =
  | { ok: true; format: AudioFormat }
  | { ok: false; reason: "too-large" | "unsupported" | "type-mismatch" };

const FORMATS: AudioFormat[] = [
  { contentType: "audio/webm", extension: "webm" },
  { contentType: "audio/mp4", extension: "m4a" },
  { contentType: "audio/mpeg", extension: "mp3" },
  { contentType: "audio/ogg", extension: "ogg" },
];

function matches(bytes: Uint8Array, format: AudioFormat): boolean {
  if (format.contentType === "audio/webm") {
    // EBML header every matroska/webm file starts with.
    return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  }

  if (format.contentType === "audio/mp4") {
    // An ISO base media box: size (4 bytes) then the "ftyp" brand.
    return bytes.length >= 8 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp";
  }

  if (format.contentType === "audio/mpeg") {
    // ID3v2 tag, or a bare MPEG audio frame sync.
    const id3 = bytes.length >= 3 &&
      bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
    if (id3) return true;
    return bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0;
  }

  return bytes.length >= 4 &&
    bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53;
}

function normalize(contentType: string | undefined): string {
  return contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

/** Validate the content itself and, when provided, require the browser MIME to agree. */
export function validateAudio(bytes: Uint8Array, declaredContentType?: string): AudioValidation {
  if (bytes.byteLength > MAX_AUDIO_BYTES) return { ok: false, reason: "too-large" };

  const format = FORMATS.find((candidate) => matches(bytes, candidate));
  if (!format) return { ok: false, reason: "unsupported" };

  const declared = normalize(declaredContentType);
  const families: Record<AudioFormat["contentType"], string[]> = {
    "audio/webm": ["audio/webm"],
    "audio/mp4": ["audio/mp4", "audio/m4a", "audio/x-m4a", "audio/mp3"],
    "audio/mpeg": ["audio/mpeg", "audio/mp3"],
    "audio/ogg": ["audio/ogg", "audio/opus", "application/ogg"],
  };
  if (declared && !families[format.contentType].includes(declared)) {
    return { ok: false, reason: "type-mismatch" };
  }

  return { ok: true, format };
}

/** "1:23" from a duration in milliseconds; sub-second stays "0:00". */
export function formatAudioDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

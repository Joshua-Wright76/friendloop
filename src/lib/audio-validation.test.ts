import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  formatAudioDuration,
  validateAudio,
} from "./audio-validation.ts";
import { isManagedBlobAudioUrl } from "./media-storage.ts";

const signatures = [
  { contentType: "audio/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] },
  { contentType: "audio/mp4", bytes: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70] },
  { contentType: "audio/mpeg", bytes: [0x49, 0x44, 0x33, 0x04] },
  { contentType: "audio/ogg", bytes: [0x4f, 0x67, 0x67, 0x53] },
] as const;

test("voice storage accepts webm, m4a, mp3, and ogg magic bytes", () => {
  for (const expected of signatures) {
    const result = validateAudio(Uint8Array.from(expected.bytes), expected.contentType);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.format.contentType, expected.contentType);
  }
});

test("a bare MPEG frame sync counts as mp3", () => {
  const result = validateAudio(Uint8Array.from([0xff, 0xfb, 0x90, 0x00]), "audio/mpeg");
  assert.equal(result.ok, true);
});

test("voice storage rejects text pretending to be audio", () => {
  assert.deepEqual(validateAudio(new TextEncoder().encode("not audio"), "audio/mpeg"), {
    ok: false,
    reason: "unsupported",
  });
});

test("codec parameters in the browser MIME do not break the match", () => {
  const result = validateAudio(Uint8Array.from(signatures[0].bytes), "audio/webm;codecs=opus");
  assert.equal(result.ok, true);
});

test("a mismatched MIME is rejected even when the bytes are valid audio", () => {
  assert.deepEqual(validateAudio(Uint8Array.from(signatures[0].bytes), "audio/mpeg"), {
    ok: false,
    reason: "type-mismatch",
  });
});

test("oversized recordings are refused before bytes are read", () => {
  const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
  big.set(signatures[0].bytes);
  assert.deepEqual(validateAudio(big, "audio/webm"), { ok: false, reason: "too-large" });
});

test("durations render as quiet wall-clock text", () => {
  assert.equal(formatAudioDuration(0), "0:00");
  assert.equal(formatAudioDuration(83_400), "1:23");
  assert.equal(formatAudioDuration(MAX_AUDIO_DURATION_MS), "3:00");
});

test("only voice notes stored by this app are removable", () => {
  assert.equal(
    isManagedBlobAudioUrl("https://team.example.public.blob.vercel-storage.com/reply-audio/".padEnd(80, "a") + ".webm"),
    false,
  );
  assert.equal(isManagedBlobAudioUrl("/uploads/not-a-hash.webm"), false);
  assert.equal(
    isManagedBlobAudioUrl(
      "https://acme.public.blob.vercel-storage.com/reply-audio/aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44ee55ff66aa11bb22cc33dd44.webm",
    ),
    true,
  );
});

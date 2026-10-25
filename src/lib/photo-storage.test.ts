import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PHOTO_BYTES, validatePhoto } from "./photo-validation.ts";
import { isManagedBlobPhotoUrl } from "./photo-storage.ts";

const signatures = [
  { contentType: "image/jpeg", bytes: [0xff, 0xd8, 0xff, 0x00] },
  { contentType: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50] },
  { contentType: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
] as const;

test("photo storage accepts JPEG, PNG, WebP, and GIF magic bytes", () => {
  for (const expected of signatures) {
    const result = validatePhoto(Uint8Array.from(expected.bytes), expected.contentType);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.format.contentType, expected.contentType);
  }
});

test("photo storage rejects a supported MIME when the bytes are not that image", () => {
  assert.deepEqual(validatePhoto(new TextEncoder().encode("not a png"), "image/png"), {
    ok: false,
    reason: "unsupported",
  });
});

test("photo storage rejects MIME and magic-byte mismatches", () => {
  assert.deepEqual(validatePhoto(Uint8Array.from(signatures[0].bytes), "image/png"), {
    ok: false,
    reason: "type-mismatch",
  });
});

test("photo storage accepts a valid signature with a missing browser MIME", () => {
  assert.deepEqual(validatePhoto(Uint8Array.from(signatures[2].bytes)), {
    ok: true,
    format: { contentType: "image/webp", extension: "webp" },
  });
});

test("photo storage enforces the 5 MB limit", () => {
  assert.deepEqual(validatePhoto(new Uint8Array(MAX_PHOTO_BYTES + 1), "image/png"), {
    ok: false,
    reason: "too-large",
  });
});

test("photo storage recognizes generated public Blob URLs only", () => {
  const randomName = "a".repeat(64);
  assert.equal(
    isManagedBlobPhotoUrl(`https://store.public.blob.vercel-storage.com/reply-photos/${randomName}-x7p9.gif`),
    true,
  );
  assert.equal(isManagedBlobPhotoUrl(`https://example.com/reply-photos/${randomName}.gif`), false);
  assert.equal(isManagedBlobPhotoUrl(`https://store.public.blob.vercel-storage.com/other/${randomName}.gif`), false);
});

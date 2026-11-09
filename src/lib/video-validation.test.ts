import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkVideoDuration,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_MS,
  sniffVideo,
  validateVideo,
  VIDEO_CONTENT_TYPES,
} from "./video-validation.ts";

const box = (brand: string) => new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftyp"), ...Buffer.from(brand)]);
const MP4 = box("isom");
const MOV = box("qt  ");
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0, 0, 0, 0, 0, 0, 0]);

test("the first bytes say which container a clip is", () => {
  assert.equal(sniffVideo(MP4)?.extension, "mp4");
  assert.equal(sniffVideo(MOV)?.extension, "mov");
  assert.equal(sniffVideo(WEBM)?.extension, "webm");
  assert.equal(sniffVideo(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), null, "a JPEG is not a video");
  assert.equal(sniffVideo(MP4.subarray(0, 8)), null, "too short to read the brand");
});

test("a clip is checked by its bytes, its size, and a type that agrees", () => {
  assert.deepEqual(validateVideo(MP4, 1000, "video/mp4"), { ok: true, format: { contentType: "video/mp4", extension: "mp4" } });
  // Phones label MP4 and QuickTime loosely; both are the same box format.
  assert.equal(validateVideo(MOV, 1000, "video/mp4").ok, true);
  assert.equal(validateVideo(MP4, 1000, "video/quicktime").ok, true);
  assert.equal(validateVideo(WEBM, 1000, "video/webm; codecs=vp9").ok, true);
  assert.equal(validateVideo(MP4, 1000, "").ok, true, "no type named is fine");
  assert.equal(validateVideo(MP4, 1000).ok, true);
  assert.deepEqual(validateVideo(WEBM, 1000, "video/mp4"), { ok: false, reason: "type-mismatch" });
  assert.deepEqual(validateVideo(MP4, MAX_VIDEO_BYTES + 1, "video/mp4"), { ok: false, reason: "too-large" });
  assert.deepEqual(validateVideo(new Uint8Array([1, 2, 3, 4]), 4, "video/mp4"), { ok: false, reason: "unsupported" });
  assert.deepEqual(VIDEO_CONTENT_TYPES, ["video/mp4", "video/quicktime", "video/webm"]);
});

test("a clip runs up to a minute, with a little grace for how containers round", () => {
  assert.equal(checkVideoDuration("42000"), 42000);
  assert.equal(checkVideoDuration(1234.6), 1235);
  assert.equal(checkVideoDuration(String(MAX_VIDEO_DURATION_MS + 400)), MAX_VIDEO_DURATION_MS, "a 60.4 s clip reads as a minute");
  assert.equal(checkVideoDuration(String(MAX_VIDEO_DURATION_MS + 5000)), null);
  assert.equal(checkVideoDuration("0"), null);
  assert.equal(checkVideoDuration("soon"), null);
  assert.equal(checkVideoDuration(null), null);
});

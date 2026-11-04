import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AVATAR_PROFILE,
  BANNER_PROFILE,
  PHOTO_PROFILE,
  browserCodec,
  encodeAttempts,
  fitWithin,
  imageKind,
  prepareImage,
  renameFor,
  uploadErrorFrom,
  type DecodedImage,
  type ImageCodec,
} from "./image-resize.ts";
import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES, MAX_PHOTO_BYTES } from "./photo-validation.ts";

const VERCEL_BODY_LIMIT = 4.5 * 1000 * 1000;

test("every upload cap leaves room under Vercel's 4.5 MB request body for the multipart envelope", () => {
  for (const cap of [MAX_PHOTO_BYTES, MAX_BANNER_BYTES, MAX_AVATAR_BYTES]) {
    assert.ok(cap + 64 * 1024 < VERCEL_BODY_LIMIT, `${cap} is too close to the platform limit`);
  }
  assert.equal(PHOTO_PROFILE.maxBytes, MAX_PHOTO_BYTES);
  assert.equal(BANNER_PROFILE.maxBytes, MAX_BANNER_BYTES);
  assert.equal(AVATAR_PROFILE.maxBytes, MAX_AVATAR_BYTES);
});

test("fitWithin scales the long edge down, keeps the aspect ratio, and never scales up", () => {
  assert.deepEqual(fitWithin(6000, 4000, 2560), { width: 2560, height: 1707 });
  assert.deepEqual(fitWithin(3024, 4032, 2560), { width: 1920, height: 2560 });
  assert.deepEqual(fitWithin(2560, 2560, 2560), { width: 2560, height: 2560 });
  assert.deepEqual(fitWithin(800, 600, 2560), { width: 800, height: 600 });
  assert.deepEqual(fitWithin(10000, 1, 512), { width: 512, height: 1 });
  assert.deepEqual(fitWithin(0, 0, 512), { width: 0, height: 0 });
});

test("imageKind reads the MIME first and the extension when the MIME is missing", () => {
  assert.equal(imageKind({ name: "a.jpg", type: "image/jpeg" }), "raster");
  assert.equal(imageKind({ name: "a.png", type: "IMAGE/PNG" }), "raster");
  assert.equal(imageKind({ name: "a.webp", type: "image/webp" }), "raster");
  assert.equal(imageKind({ name: "a.gif", type: "image/gif" }), "gif");
  assert.equal(imageKind({ name: "IMG_1.HEIC", type: "" }), "heic");
  assert.equal(imageKind({ name: "x", type: "image/heif" }), "heic");
  assert.equal(imageKind({ name: "x.heif", type: "application/octet-stream" }), "heic");
  assert.equal(imageKind({ name: "photo", type: "" }), "unknown");
  assert.equal(imageKind({ name: "notes.txt", type: "text/plain" }), "unsupported");
});

test("renameFor swaps the extension for the encoded type", () => {
  assert.equal(renameFor("IMG_1234.HEIC", "image/jpeg"), "IMG_1234.jpg");
  assert.equal(renameFor("logo.png", "image/webp"), "logo.webp");
  assert.equal(renameFor("no-extension", "image/jpeg"), "no-extension.jpg");
  assert.equal(renameFor(".png", "image/jpeg"), "photo.jpg");
});

test("encodeAttempts lowers quality before shrinking further", () => {
  assert.deepEqual(encodeAttempts(PHOTO_PROFILE), [
    { maxEdge: 2560, quality: 0.85 },
    { maxEdge: 2560, quality: 0.7 },
    { maxEdge: 1920, quality: 0.7 },
    { maxEdge: 1280, quality: 0.7 },
  ]);
  assert.equal(encodeAttempts({ maxEdge: 100, maxBytes: 1, quality: 0.5 })[1].quality, 0.5);
});

type EncodeCall = { width: number; height: number; type: string; quality: number };

function fakeCodec(options: {
  width?: number;
  height?: number;
  decodeFails?: "throw" | "null";
  /** Size of each successive encode result; the last value repeats. */
  sizes?: number[];
  /** Pretend the engine can't write WebP and hands back PNG instead. */
  noWebp?: boolean;
  encodeNull?: boolean;
}) {
  const calls: EncodeCall[] = [];
  let closed = 0;
  const sizes = options.sizes ?? [200_000];
  const codec: ImageCodec = {
    async decode() {
      if (options.decodeFails === "throw") throw new Error("cannot decode");
      if (options.decodeFails === "null") return null;
      return {
        width: options.width ?? 6000,
        height: options.height ?? 4000,
        source: {} as CanvasImageSource,
        close: () => { closed += 1; },
      };
    },
    async encode(_image, width, height, type, quality) {
      calls.push({ width, height, type, quality });
      if (options.encodeNull) return null;
      const size = sizes[Math.min(calls.length - 1, sizes.length - 1)];
      const outType = type === "image/webp" && options.noWebp ? "image/png" : type;
      return new Blob([new Uint8Array(size)], { type: outType });
    },
  };
  return { codec, calls, closed: () => closed };
}

function fileOf(name: string, type: string, size: number) {
  return new File([new Uint8Array(size)], name, { type });
}

test("a large phone photo is scaled to the long edge and re-encoded as JPEG", async () => {
  const fake = fakeCodec({ width: 6000, height: 4000 });
  const result = await prepareImage(fileOf("IMG_0001.jpg", "image/jpeg", 9 * 1024 * 1024), PHOTO_PROFILE, fake.codec);
  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.resized, true);
  assert.equal(result.file.name, "IMG_0001.jpg");
  assert.equal(result.file.type, "image/jpeg");
  assert.equal(result.file.size, 200_000);
  assert.deepEqual(fake.calls, [{ width: 2560, height: 1707, type: "image/jpeg", quality: 0.85 }]);
  assert.equal(fake.closed(), 1);
});

test("a picture already within both limits goes up untouched", async () => {
  const fake = fakeCodec({ width: 1200, height: 900 });
  const file = fileOf("small.png", "image/png", 300_000);
  const result = await prepareImage(file, PHOTO_PROFILE, fake.codec);
  assert.deepEqual(result, { ok: true, file, resized: false });
  assert.equal(fake.calls.length, 0);
  assert.equal(fake.closed(), 1);
});

test("a small-dimension picture that is still too heavy is re-encoded", async () => {
  const fake = fakeCodec({ width: 2000, height: 2000 });
  const result = await prepareImage(fileOf("scan.jpg", "image/jpeg", 5 * 1024 * 1024), PHOTO_PROFILE, fake.codec);
  assert.ok(result.ok && result.resized);
  assert.deepEqual(fake.calls[0], { width: 2000, height: 2000, type: "image/jpeg", quality: 0.85 });
});

test("PNG keeps transparency as WebP, falling back to JPEG where WebP can't be written", async () => {
  const webp = fakeCodec({});
  const asWebp = await prepareImage(fileOf("logo.png", "image/png", 6 * 1024 * 1024), BANNER_PROFILE, webp.codec);
  assert.ok(asWebp.ok);
  assert.equal(asWebp.file.type, "image/webp");
  assert.equal(asWebp.file.name, "logo.webp");

  const noWebp = fakeCodec({ noWebp: true });
  const asJpeg = await prepareImage(fileOf("logo.png", "image/png", 6 * 1024 * 1024), BANNER_PROFILE, noWebp.codec);
  assert.ok(asJpeg.ok);
  assert.equal(asJpeg.file.type, "image/jpeg");
  assert.deepEqual(noWebp.calls.map((call) => call.type), ["image/webp", "image/jpeg"]);
});

test("avatars shrink to their smaller edge", async () => {
  const fake = fakeCodec({ width: 3024, height: 4032 });
  const result = await prepareImage(fileOf("me.webp", "image/webp", 3 * 1024 * 1024), AVATAR_PROFILE, fake.codec);
  assert.ok(result.ok);
  assert.deepEqual(fake.calls[0], { width: 384, height: 512, type: "image/webp", quality: 0.85 });
});

test("an encode that stays too heavy steps down quality, then size, then gives up", async () => {
  const big = MAX_PHOTO_BYTES + 1;
  const fitsLater = fakeCodec({ sizes: [big, big, 1_000_000] });
  const result = await prepareImage(fileOf("noise.jpg", "image/jpeg", 20 * 1024 * 1024), PHOTO_PROFILE, fitsLater.codec);
  assert.ok(result.ok);
  assert.deepEqual(fitsLater.calls.map((call) => [call.width, call.quality]), [[2560, 0.85], [2560, 0.7], [1920, 0.7]]);

  const never = fakeCodec({ sizes: [big] });
  assert.deepEqual(
    await prepareImage(fileOf("noise.jpg", "image/jpeg", 20 * 1024 * 1024), PHOTO_PROFILE, never.codec),
    { ok: false, reason: "too-large" },
  );
  assert.equal(never.calls.length, 4);
  assert.equal(never.closed(), 1);
});

test("an engine that can't encode reports the picture as too large", async () => {
  const fake = fakeCodec({ encodeNull: true });
  assert.deepEqual(
    await prepareImage(fileOf("a.jpg", "image/jpeg", 9 * 1024 * 1024), PHOTO_PROFILE, fake.codec),
    { ok: false, reason: "too-large" },
  );
  assert.equal(fake.calls.length, 1);
});

test("GIFs go up as they are, so animation survives, within the cap", async () => {
  const fake = fakeCodec({});
  const small = fileOf("dance.gif", "image/gif", 1_000_000);
  assert.deepEqual(await prepareImage(small, PHOTO_PROFILE, fake.codec), { ok: true, file: small, resized: false });
  assert.deepEqual(
    await prepareImage(fileOf("dance.gif", "image/gif", MAX_PHOTO_BYTES + 1), PHOTO_PROFILE, fake.codec),
    { ok: false, reason: "too-large" },
  );
  assert.equal(fake.calls.length, 0);
});

test("HEIC converts when the browser can read it and is refused plainly when it can't", async () => {
  const readable = fakeCodec({ width: 4032, height: 3024 });
  const converted = await prepareImage(fileOf("IMG_9.HEIC", "image/heic", 2_000_000), PHOTO_PROFILE, readable.codec);
  assert.ok(converted.ok);
  assert.equal(converted.file.name, "IMG_9.jpg");
  assert.equal(converted.file.type, "image/jpeg");

  // Even a small HEIC is re-encoded: the server only takes JPEG, PNG, WebP and GIF.
  const tiny = fakeCodec({ width: 100, height: 100 });
  const small = await prepareImage(fileOf("x.heic", "", 1000), PHOTO_PROFILE, tiny.codec);
  assert.ok(small.ok && small.resized);

  const unreadable = fakeCodec({ decodeFails: "throw" });
  assert.deepEqual(
    await prepareImage(fileOf("IMG_9.HEIC", "image/heic", 2_000_000), PHOTO_PROFILE, unreadable.codec),
    { ok: false, reason: "unsupported" },
  );
});

test("an undecodable file is left to the server when it fits and refused when it can't", async () => {
  const fake = fakeCodec({ decodeFails: "null" });
  const fits = fileOf("odd.jpg", "image/jpeg", 1000);
  assert.deepEqual(await prepareImage(fits, PHOTO_PROFILE, fake.codec), { ok: true, file: fits, resized: false });
  assert.deepEqual(
    await prepareImage(fileOf("huge.png", "image/png", MAX_PHOTO_BYTES + 1), PHOTO_PROFILE, fake.codec),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(
    await prepareImage(fileOf("notes.txt", "text/plain", 10), PHOTO_PROFILE, fake.codec),
    { ok: false, reason: "unsupported" },
  );
});

test("uploadErrorFrom prefers the app's message and names a platform 413 plainly", async () => {
  assert.equal(
    await uploadErrorFrom(Response.json({ error: "Not yours." }, { status: 403 }), "too big", "generic"),
    "Not yours.",
  );
  assert.equal(
    await uploadErrorFrom(new Response("Request Entity Too Large", { status: 413 }), "too big", "generic"),
    "too big",
  );
  assert.equal(await uploadErrorFrom(new Response("<html>", { status: 502 }), "too big", "generic"), "generic");
  assert.equal(await uploadErrorFrom(Response.json({ error: "" }, { status: 500 }), "too big", "generic"), "generic");
});

type Globals = Record<string, unknown>;

function stubGlobals(t: { after: (fn: () => void) => void }, values: Globals) {
  const globals = globalThis as unknown as Globals;
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, globals[key]]));
  Object.assign(globals, values);
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globals[key];
      else globals[key] = value;
    }
  });
}

function fakeContext(log: string[]) {
  return {
    set fillStyle(value: string) { log.push(`fill ${value}`); },
    fillRect: (_x: number, _y: number, w: number, h: number) => log.push(`rect ${w}x${h}`),
    set imageSmoothingQuality(value: string) { log.push(`smooth ${value}`); },
    drawImage: (_s: unknown, _x: number, _y: number, w: number, h: number) => log.push(`draw ${w}x${h}`),
  };
}

const decoded: DecodedImage = { width: 10, height: 10, source: {} as CanvasImageSource, close: () => undefined };

test("the browser codec decodes with EXIF orientation and falls back for older engines", async (t) => {
  const options: unknown[] = [];
  let closed = false;
  stubGlobals(t, {
    createImageBitmap: async (_file: Blob, opts?: { imageOrientation?: string }) => {
      options.push(opts);
      if (opts && options.length === 1) throw new TypeError("bad enum");
      return { width: 30, height: 20, close: () => { closed = true; } };
    },
  });
  const image = await browserCodec.decode(new Blob());
  assert.ok(image);
  assert.equal(image.width, 30);
  assert.equal(image.height, 20);
  image.close();
  assert.equal(closed, true);
  assert.deepEqual(options, [{ imageOrientation: "from-image" }, undefined]);

  const direct = await browserCodec.decode(new Blob());
  assert.ok(direct);
  assert.deepEqual(options[2], { imageOrientation: "from-image" });
});

test("the browser codec reports nothing to decode without createImageBitmap", async (t) => {
  stubGlobals(t, { createImageBitmap: undefined });
  assert.equal(await browserCodec.decode(new Blob()), null);
});

test("the browser codec paints onto an OffscreenCanvas, filling white under JPEG", async (t) => {
  const log: string[] = [];
  let withContext = true;
  stubGlobals(t, {
    OffscreenCanvas: class {
      getContext() { return withContext ? fakeContext(log) : null; }
      async convertToBlob(opts: { type: string; quality: number }) {
        log.push(`blob ${opts.type} ${opts.quality}`);
        return new Blob(["x"], { type: opts.type });
      }
    },
  });
  const jpeg = await browserCodec.encode(decoded, 40, 30, "image/jpeg", 0.8);
  assert.equal(jpeg?.type, "image/jpeg");
  assert.deepEqual(log, ["fill #ffffff", "rect 40x30", "smooth high", "draw 40x30", "blob image/jpeg 0.8"]);

  log.length = 0;
  await browserCodec.encode(decoded, 40, 30, "image/webp", 0.8);
  assert.deepEqual(log, ["smooth high", "draw 40x30", "blob image/webp 0.8"]);

  withContext = false;
  assert.equal(await browserCodec.encode(decoded, 40, 30, "image/jpeg", 0.8), null);
});

test("the browser codec falls back to a DOM canvas", async (t) => {
  const log: string[] = [];
  let withContext = true;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => (withContext ? fakeContext(log) : null),
    toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
      log.push(`blob ${type} ${quality} ${canvas.width}x${canvas.height}`);
      done(new Blob(["x"], { type }));
    },
  };
  stubGlobals(t, {
    OffscreenCanvas: undefined,
    document: { createElement: (tag: string) => (tag === "canvas" ? canvas : null) },
  });
  const blob = await browserCodec.encode(decoded, 12, 8, "image/webp", 0.7);
  assert.equal(blob?.type, "image/webp");
  assert.deepEqual(log, ["smooth high", "draw 12x8", "blob image/webp 0.7 12x8"]);

  withContext = false;
  assert.equal(await browserCodec.encode(decoded, 12, 8, "image/jpeg", 0.7), null);
});

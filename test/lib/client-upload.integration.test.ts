import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { uploadReplyPhoto } from "../../src/lib/reply-client.ts";
import { copy } from "../../src/lib/copy.ts";
import { setEnv, setupDatabase } from "../support/app.ts";
import { uploads as blobUploads, reset as resetUploads } from "../stubs/vercel-blob-client.mjs";

/**
 * The production upload path: validate, upload to Blob, then wait for our own
 * route to confirm the file landed. Only reachable when NODE_ENV is production,
 * which is exactly why it never ran in a test before.
 */

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]);

beforeEach(async () => {
  resetUploads();
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}


setupDatabase();

test("production uploads to a hashed pathname and waits for the route to confirm", async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => {
    setEnv("NODE_ENV", original);
  });
  setEnv("NODE_ENV", "production");

  const file = new File([JPEG], "camera.jpg", { type: "image/jpeg" });
  let attempts = 0;
  const result = await uploadReplyPhoto("reply-token", "question-id", file, copy.reply.errors.photoUploadFailed, async () => {
    attempts += 1;
    // First poll: the server has not seen the blob yet. Second: it has.
    if (attempts === 1) return jsonResponse(202, { ok: false, pending: true });
    return jsonResponse(200, { ok: true, photoUrl: "https://store123.public.blob.vercel-storage.com/reply-photos/x.jpg" });
  });

  assert.equal(result.ok, true);
  if (result.ok) assert.match(result.photoUrl, /reply-photos\/x\.jpg$/);
  assert.equal(attempts, 2, "it polls until the server has recorded the upload");

  assert.equal(blobUploads.length, 1);
  assert.match(blobUploads[0].pathname as string, /^reply-photos\/[a-f0-9]{64}\.jpg$/);
  assert.equal(blobUploads[0].options.contentType, "image/jpeg");
  assert.equal(blobUploads[0].options.access, "public");
  assert.equal(blobUploads[0].options.handleUploadUrl, "/api/reply/reply-token/photo");
  assert.deepEqual(JSON.parse(blobUploads[0].options.clientPayload as string), {
    issueQuestionId: "question-id",
  });
});

test("production refuses a file that is not the image it claims to be", async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => {
    setEnv("NODE_ENV", original);
  });
  setEnv("NODE_ENV", "production");

  const notAnImage = new File([new TextEncoder().encode("just text")], "photo.png", {
    type: "image/png",
  });
  const result = await uploadReplyPhoto("reply-token", "question-id", notAnImage, "generic", async () => {
    throw new Error("the fetcher must not run");
  });

  assert.deepEqual(result, { ok: false, error: copy.reply.errors.invalidPhoto });
  assert.equal(blobUploads.length, 0, "nothing was uploaded");
});

test("production reports the route's refusal rather than waiting forever", async (t) => {
  const original = process.env.NODE_ENV;
  t.after(() => {
    setEnv("NODE_ENV", original);
  });
  setEnv("NODE_ENV", "production");

  const file = new File([JPEG], "camera.jpg", { type: "image/jpeg" });
  const result = await uploadReplyPhoto("reply-token", "question-id", file, "generic", async () =>
    jsonResponse(415, { error: "That photo is not a supported image." }),
  );

  assert.deepEqual(result, { ok: false, error: "That photo is not a supported image." });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSerialDraftWriter,
  postReply,
  removeReplyAudio,
  removeReplyPhoto,
  saveReminderPreference,
  saveReplyName,
  uploadReplyAudio,
  uploadReplyPhoto,
} from "./reply-client.ts";

test("postReply turns network and response parsing exceptions into failed results", async () => {
  const networkFailure = await postReply("token", {}, "Could not save", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(networkFailure, { ok: false, error: "Could not save" });

  const parseFailure = await postReply("token", {}, "Could not save", async () => ({
    ok: true,
    json: async () => { throw new Error("invalid json"); },
  }) as unknown as Response);
  assert.deepEqual(parseFailure, { ok: false, error: "Could not save" });
});

test("photo upload sends multipart form data and returns the stored URL", async () => {
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "ignored-name.jpg", { type: "image/jpeg" });
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody!: FormData;

  const result = await uploadReplyPhoto("reply-token", "question-id", file, "Could not upload", async (input, init) => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "";
    capturedBody = init?.body as FormData;
    return {
      ok: true,
      json: async () => ({ ok: true, savedAt: "now", photoUrl: "http://localhost:3000/uploads/photo.jpg" }),
    } as Response;
  });

  assert.deepEqual(result, {
    ok: true,
    savedAt: "now",
    photoUrl: "http://localhost:3000/uploads/photo.jpg",
  });
  assert.equal(capturedUrl, "/api/reply/reply-token/photo");
  assert.equal(capturedMethod, "POST");
  assert.equal(capturedBody.get("issueQuestionId"), "question-id");
  assert.equal((capturedBody.get("photo") as File).name, "ignored-name.jpg");
});

test("photo removal uses DELETE and reports server errors", async () => {
  let capturedMethod = "";
  let capturedBody = "";
  const result = await removeReplyPhoto("reply-token", "question-id", "Could not remove", async (_input, init) => {
    capturedMethod = init?.method ?? "";
    capturedBody = init?.body as string;
    return {
      ok: false,
      json: async () => ({ error: "That question isn't in this round." }),
    } as Response;
  });

  assert.deepEqual(result, { ok: false, error: "That question isn't in this round." });
  assert.equal(capturedMethod, "DELETE");
  assert.deepEqual(JSON.parse(capturedBody), { issueQuestionId: "question-id" });
});

test("draft writes for one question are serialized so the latest body is written last", async () => {
  const writes: string[] = [];
  let releaseFirst!: () => void;
  let markFirstStarted!: () => void;
  const firstWriteBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  const write = createSerialDraftWriter(async (_questionId, body) => {
    writes.push(`start:${body}`);
    if (body === "older") {
      markFirstStarted();
      await firstWriteBlocked;
    }
    writes.push(`done:${body}`);
  });

  const older = write("q1", "older");
  const newer = write("q1", "newer");
  await firstStarted;
  assert.deepEqual(writes, ["start:older"]);

  releaseFirst();
  await Promise.all([older, newer]);
  assert.deepEqual(writes, ["start:older", "done:older", "start:newer", "done:newer"]);
});

test("draft writes to separate questions remain independent", async () => {
  const writes: string[] = [];
  const write = createSerialDraftWriter(async (questionId, body) => {
    writes.push(`${questionId}:${body}`);
  });

  await Promise.all([write("q1", "first"), write("q2", "other")]);
  assert.deepEqual(new Set(writes), new Set(["q1:first", "q2:other"]));
});

test("a rejected photo request reports what the server said", async () => {
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" });
  const result = await uploadReplyPhoto("reply-token", "question-id", file, "Could not upload", async () =>
    ({
      ok: false,
      json: async () => ({ ok: false, error: "That photo is too large." }),
    }) as unknown as Response,
  );
  assert.deepEqual(result, { ok: false, error: "That photo is too large." });
});

test("a photo request that throws is a failed save, not an exception", async () => {
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" });
  const result = await uploadReplyPhoto("reply-token", "question-id", file, "Could not upload", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(result, { ok: false, error: "Could not upload" });
});

test("removing a photo reports failures and survives a network error", async () => {
  const refused = await removeReplyPhoto("reply-token", "question-id", "Could not remove", async () =>
    ({ ok: false, json: async () => ({ error: "Not your answer." }) }) as unknown as Response,
  );
  assert.deepEqual(refused, { ok: false, error: "Not your answer." });

  const offline = await removeReplyPhoto("reply-token", "question-id", "Could not remove", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(offline, { ok: false, error: "Could not remove" });

  const saved = await removeReplyPhoto("reply-token", "question-id", "Could not remove", async () =>
    ({ ok: true, json: async () => ({ ok: true, savedAt: "2026-01-02T08:05:00.000Z" }) }) as unknown as Response,
  );
  assert.deepEqual(saved, { ok: true, savedAt: "2026-01-02T08:05:00.000Z" });
});

test("saving a name posts the name action", async () => {
  let body: unknown;
  const result = await saveReplyName("reply-token", "Alice", "Could not save", async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return {
      ok: true,
      json: async () => ({ ok: true, savedAt: "2026-01-02T08:05:00.000Z", name: "Alice" }),
    } as unknown as Response;
  });
  assert.deepEqual(body, { action: "name", name: "Alice" });
  assert.deepEqual(result, { ok: true, savedAt: "2026-01-02T08:05:00.000Z" });
});

test("saving a reminder preference posts the reminders action", async () => {
  let body: unknown;
  const result = await saveReminderPreference("reply-token", "none", "Could not save", async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return {
      ok: true,
      json: async () => ({ ok: true, savedAt: "2026-01-02T08:05:00.000Z" }),
    } as unknown as Response;
  });
  assert.deepEqual(body, { action: "reminders", preference: "none" });
  assert.deepEqual(result, { ok: true, savedAt: "2026-01-02T08:05:00.000Z" });
});

test("a rejected write does not stall the next one for that question", async () => {
  const calls: string[] = [];
  const writer = createSerialDraftWriter<string>(async (questionId, body) => {
    calls.push(`${questionId}:${body}`);
    if (body === "boom") throw new Error("server said no");
    return body;
  });

  // Queued behind a write that is still in flight and about to fail.
  const failing = writer("q1", "boom");
  const queued = writer("q1", "after the failure");

  await assert.rejects(failing);
  assert.equal(await queued, "after the failure");
  assert.deepEqual(calls, ["q1:boom", "q1:after the failure"]);

  // And a later, non-overlapping write starts from a clean slate.
  assert.equal(await writer("q1", "much later"), "much later");
});

test("an audio upload posts multipart and returns what the app stored", async () => {
  const audio = new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody!: FormData;

  const result = await uploadReplyAudio("reply-token", "question-id", audio, "note.webm", 1234.6, "Could not upload", async (input, init) => {
    capturedUrl = String(input);
    capturedMethod = init?.method ?? "";
    capturedBody = init?.body as FormData;
    return {
      ok: true,
      json: async () => ({ ok: true, savedAt: "now", audioUrl: "/uploads/note.webm", audioDurationMs: 1235 }),
    } as unknown as Response;
  });

  assert.deepEqual(result, { ok: true, savedAt: "now", audioUrl: "/uploads/note.webm", audioDurationMs: 1235 });
  assert.equal(capturedUrl, "/api/reply/reply-token/audio");
  assert.equal(capturedMethod, "POST");
  assert.equal(capturedBody.get("issueQuestionId"), "question-id");
  assert.equal(capturedBody.get("durationMs"), "1235");
});

test("audio upload failures carry the server's words or the fallback", async () => {
  const audio = new Blob([Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm" });

  const refused = await uploadReplyAudio("reply-token", "q", audio, "note.webm", 100, "fallback", async () =>
    ({ ok: false, json: async () => ({ error: "3 minutes max." }) }) as unknown as Response,
  );
  assert.deepEqual(refused, { ok: false, error: "3 minutes max." });

  const malformed = await uploadReplyAudio("reply-token", "q", audio, "note.webm", 100, "fallback", async () =>
    ({ ok: true, json: async () => ({ ok: true }) }) as unknown as Response,
  );
  assert.deepEqual(malformed, { ok: false, error: "fallback" });

  const offline = await uploadReplyAudio("reply-token", "q", audio, "note.webm", 100, "fallback", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(offline, { ok: false, error: "fallback" });
});

test("audio removal reports failures and survives a network error", async () => {
  const refused = await removeReplyAudio("reply-token", "q", "fallback", async () =>
    ({ ok: false, json: async () => ({ error: "Not your answer." }) }) as unknown as Response,
  );
  assert.deepEqual(refused, { ok: false, error: "Not your answer." });

  const offline = await removeReplyAudio("reply-token", "q", "fallback", async () => {
    throw new Error("offline");
  });
  assert.deepEqual(offline, { ok: false, error: "fallback" });

  const saved = await removeReplyAudio("reply-token", "q", "fallback", async () =>
    ({ ok: true, json: async () => ({ ok: true, savedAt: "now" }) }) as unknown as Response,
  );
  assert.deepEqual(saved, { ok: true, savedAt: "now" });
});

test("a platform 413 (plain text, not JSON) reads as the friendly size error", async () => {
  const platform413 = (async () => new Response("Request Entity Too Large", { status: 413 })) as typeof fetch;
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "big.jpg", { type: "image/jpeg" });
  assert.deepEqual(
    await uploadReplyPhoto("t", "q", file, "Could not upload", platform413),
    { ok: false, error: "That photo is over 4 MB. Try a smaller one." },
  );
  const audio = await uploadReplyAudio("t", "q", new Blob(["x"]), "note.webm", 1000, "fallback", platform413);
  assert.ok(!audio.ok);
  assert.match(audio.error, /too big/);
});

test("a 200 photo response without a stored URL is still a failed upload", async () => {
  const file = new File([Uint8Array.from([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
  const result = await uploadReplyPhoto("t", "q", file, "Could not upload", (async () =>
    Response.json({ ok: false, error: "Not saved." })) as typeof fetch);
  assert.deepEqual(result, { ok: false, error: "Not saved." });
  const silent = await uploadReplyPhoto("t", "q", file, "Could not upload", (async () => Response.json({})) as typeof fetch);
  assert.deepEqual(silent, { ok: false, error: "Could not upload" });
});

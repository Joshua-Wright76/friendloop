import { test } from "node:test";
import assert from "node:assert/strict";
import { removeReplySectionMedia, uploadReplySectionPhoto } from "./section-client.ts";
import { copy } from "./copy.ts";

function fetcher(data: unknown, init?: { status?: number; throw?: boolean }) {
  return (async () => {
    if (init?.throw) throw new Error("offline");
    return new Response(JSON.stringify(data), { status: init?.status ?? 200 });
  }) as typeof fetch;
}

test("a section photo upload reports success with its media id", async () => {
  const result = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "failed", fetcher({ ok: true, savedAt: "now", mediaId: "m1", url: "/uploads/webm" }));
  assert.deepEqual(result, { ok: true, savedAt: "now", mediaId: "m1", url: "/uploads/webm" });
});

test("a rejected upload carries the server's wording", async () => {
  const busy = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "failed", fetcher({ ok: false, error: "six is the limit" }, { status: 409 }));
  assert.deepEqual(busy, { ok: false, error: "six is the limit" });

  const malformed = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "fallback", fetcher({}));
  assert.deepEqual(malformed, { ok: false, error: "fallback" });

  const offline = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "fallback", fetcher(null, { throw: true }));
  assert.deepEqual(offline, { ok: false, error: "fallback" });
});

test("wall cleanup removes the media row or reports why not", async () => {
  const ok = await removeReplySectionMedia("t", "s", "m1", "failed", async () => new Response(JSON.stringify({ ok: true, savedAt: "now" })));
  assert.deepEqual(ok, { ok: true, savedAt: "now" });

  const fail = await removeReplySectionMedia("t", "s", "m1", "fallback", async () => new Response(JSON.stringify({ ok: false, error: "gone" }), { status: 404 }));
  assert.deepEqual(fail, { ok: false, error: "gone" });

  const offline = await removeReplySectionMedia("t", "s", "m1", "fallback", (async () => {
    throw new Error("offline");
  }) as typeof fetch);
  assert.deepEqual(offline, { ok: false, error: "fallback" });
});

test("the response itself can fail to parse", async () => {
  const parse = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "fallback", (async () => new Response("<html>", { status: 502 })) as typeof fetch);
  assert.deepEqual(parse, { ok: false, error: "fallback" });
});

test("a platform 413 on a section photo reads as the size message, not a generic error", async () => {
  const platform = (async () => new Response("Request Entity Too Large", { status: 413 })) as typeof fetch;
  const result = await uploadReplySectionPhoto("t", "s", new File(["x"], "p.png", { type: "image/png" }), "", 0, "generic", platform);
  assert.deepEqual(result, { ok: false, error: copy.reply.errors.photoTooLarge });
});

test("wall photos go to the question's media endpoint, named by the question", async () => {
  const seen: Array<{ url: string; body: unknown }> = [];
  const capture = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), body: init?.body });
    return new Response(JSON.stringify({ ok: true, savedAt: "now", mediaId: "m1", url: "/u" }));
  }) as typeof fetch;
  await uploadReplySectionPhoto("tok", "q1", new File(["x"], "p.png", { type: "image/png" }), "cap", 2, "failed", capture);
  await removeReplySectionMedia("tok", "q1", "m1", "failed", capture);
  assert.equal(seen[0].url, "/api/reply/tok/media");
  assert.equal((seen[0].body as FormData).get("issueQuestionId"), "q1");
  assert.equal(seen[1].url, "/api/reply/tok/media");
  assert.deepEqual(JSON.parse(String(seen[1].body)), { issueQuestionId: "q1", mediaId: "m1" });
});

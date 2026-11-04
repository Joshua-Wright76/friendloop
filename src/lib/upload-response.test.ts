import { test } from "node:test";
import assert from "node:assert/strict";
import { readUploadResponse } from "./upload-response.ts";

const plain413 = () => new Response("Request Entity Too Large", { status: 413 });

test("a platform 413 in plain text reads as the size message", async () => {
  assert.deepEqual(await readUploadResponse(plain413(), "Too big"), { error: "Too big" });
});

test("our own 413 keeps its more specific message", async () => {
  const response = Response.json({ error: "Over 2 MB" }, { status: 413 });
  assert.deepEqual(await readUploadResponse(response, "Too big"), { error: "Over 2 MB" });
});

test("other answers read as JSON, and a non-JSON one still throws", async () => {
  assert.deepEqual(await readUploadResponse(Response.json({ ok: true }), "Too big"), { ok: true });
  await assert.rejects(readUploadResponse(new Response("<html>", { status: 502 }), "Too big"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSerialDraftWriter, postReply } from "./reply-client.ts";

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

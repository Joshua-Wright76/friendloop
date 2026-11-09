import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  deleteAudioIfUnreferenced,
  removeAudioFor,
  saveAudioFor,
} from "../../src/lib/reply.ts";
import { deleteStoredAudio, isManagedBlobAudioUrl, storeAudio } from "../../src/lib/media-storage.ts";
import { resetDatabase, rows, seedLoop, seedOpenIssue, setupDatabase, setEnv } from "../support/app.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { makeWebm } from "../../e2e/support/audio.ts";
import { makeUndeletable, onDisk } from "../support/uploads.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { calls as blobCalls, reset as resetBlob } from "../stubs/vercel-blob.mjs";

beforeEach(async () => {
  await resetDatabase();
  resetBlob();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

setupDatabase();

const WEBM = new Uint8Array(makeWebm());

async function openLoop() {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 order by position limit 1",
    [issue.issueId],
  );
  return { loop, alice, question };
}

test("dev and e2e audio is stored on disk under its hashed name", async (t) => {
  const originalE2E = process.env.E2E;
  t.after(() => setEnv("E2E", originalE2E));

  process.env.E2E = "1";
  const url = await storeAudio(WEBM, { contentType: "audio/webm", extension: "webm" });
  assert.match(url, /^http:\/\/localhost:3100\/uploads\/[a-f0-9]{64}\.webm$/);
  assert.equal(existsSync(path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!)), true);

  await deleteStoredAudio(url);
  assert.equal(existsSync(path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!)), false);

  // A foreign host or shape is left alone rather than unlinked blindly.
  await deleteStoredAudio("https://evil.example/csv/1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef.webm");
  await deleteStoredAudio("not a url at all");
});

test("production audio goes to the blob store, and needs its token", async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalE2E = process.env.E2E;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  t.after(() => {
    setEnv("NODE_ENV", originalEnv);
    setEnv("E2E", originalE2E);
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  setEnv("NODE_ENV", "production");
  delete process.env.E2E;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(storeAudio(WEBM, { contentType: "audio/webm", extension: "webm" }), /BLOB_READ_WRITE_TOKEN/);

  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
  const url = await storeAudio(WEBM, { contentType: "audio/webm", extension: "webm" });
  assert.match(url, /^https:\/\/.+\.public\.blob\.vercel-storage\.com\/reply-audio\/[a-f0-9]{64}\.webm$/);
  assert.ok(isManagedBlobAudioUrl(url));

  await deleteStoredAudio(url);
  assert.equal(blobCalls.del.length, 1);
});

test("only production blob audio counts as managed", () => {
  assert.equal(isManagedBlobAudioUrl("https://store1.blob.vercel-storage.com/reply-audio/webm"), false);
  assert.equal(isManagedBlobAudioUrl("/uploads/" + "a".repeat(64) + ".webm"), false);
});

test("a voice note saves against its question and replaces cleanly", async () => {
  const { alice, question } = await openLoop();

  const first = await saveAudioFor({
    token: alice.token,
    issueQuestionId: question.id,
    audioUrl: "/uploads/" + "b".repeat(64) + ".webm",
    audioDurationMs: 1500,
  });
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.audioDurationMs, 1500);
    const [row] = await rows<{ audio_url: string }>("select audio_url from replies where audio_url is not null");
    assert.equal(row.audio_url, "/uploads/" + "b".repeat(64) + ".webm");
  }

  // Replacing drops the old url since nothing else references it.
  const replaced = await saveAudioFor({
    token: alice.token,
    issueQuestionId: question.id,
    audioUrl: "/uploads/" + "c".repeat(64) + ".webm",
    audioDurationMs: 900,
  });
  assert.equal(replaced.ok, true);
  const [last] = await rows<{ audio_url: string }>("select audio_url from replies where audio_url is not null");
  assert.equal(last.audio_url, "/uploads/" + "c".repeat(64) + ".webm");
});

test("another question's url is refused, and removing clears it", async () => {
  const { loop, alice, question } = await openLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const stolen = await saveAudioFor({
    token: bob.token,
    issueQuestionId: question.id,
    audioUrl: "/uploads/" + "d".repeat(64) + ".webm",
    audioDurationMs: 1000,
  });
  assert.equal(stolen.ok, true);

  // Alice would clobber Bob's upload on her own question: refused, clearly.
  const conflict = await saveAudioFor({
    token: alice.token,
    issueQuestionId: question.id,
    audioUrl: "/uploads/" + "d".repeat(64) + ".webm",
    audioDurationMs: 1000,
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.status, 409);

  const removed = await removeAudioFor({ token: bob.token, issueQuestionId: question.id });
  assert.equal(removed.ok, true);
  const [left] = await rows<{ audio_url: string | null }>(
    "select audio_url from replies where audio_url is not null",
  );
  assert.equal(left, undefined);

  // Removing when there is nothing to remove is still a success.
  const again = await removeAudioFor({ token: bob.token, issueQuestionId: question.id });
  assert.equal(again.ok, true);
  await deleteAudioIfUnreferenced("/uploads/" + "d".repeat(64) + ".webm");
});

test("a voice note replacement accepts quietly even when the old file refuses to leave", async (t) => {
  const firstUrl = "/uploads/" + "e".repeat(64) + ".webm";

  const { alice, question } = await openLoop();

  // The invite is not accepted yet, so the first write accepts it.
  await rows("update memberships set accepted_at = null where id = $1", [alice.id]);
  const first = await saveAudioFor({ token: alice.token, issueQuestionId: question.id, audioUrl: firstUrl, audioDurationMs: 700 });
  assert.equal(first.ok, true);
  const [accepted] = await rows<{ accepted_at: string | null }>("select accepted_at from memberships where id = $1", [alice.id]);
  assert.ok(accepted.accepted_at, "the first write accepts the invite");

  // The replaced file stays put, and the save still lands and reports success.
  await makeUndeletable(t, firstUrl);
  const replaced = await saveAudioFor({
    token: alice.token,
    issueQuestionId: question.id,
    audioUrl: "/uploads/" + "f".repeat(64) + ".webm",
    audioDurationMs: 900,
  });
  assert.equal(replaced.ok, true);
  const [stored] = await rows<{ audio_url: string }>("select audio_url from replies where audio_url is not null");
  assert.equal(stored.audio_url, "/uploads/" + "f".repeat(64) + ".webm");
  assert.equal(existsSync(onDisk(firstUrl)), true, "the old file really did refuse");

  // The same grace applies to removal.
  await saveAudioFor({ token: alice.token, issueQuestionId: question.id, audioUrl: firstUrl, audioDurationMs: 900 });
  const removed = await removeAudioFor({ token: alice.token, issueQuestionId: question.id });
  assert.equal(removed.ok, true);
  assert.equal(existsSync(onDisk(firstUrl)), true, "the removed file really did refuse");
});

test("audio removal only touches urls owned by this app", async () => {
  await deleteStoredAudio("http://a b"); // unparseable: ignored outright
  await deleteStoredAudio("https://stranger.example/reply-audio/1234567890abcdef.webm");
  assert.equal(blobCalls.del.length, 0);
});

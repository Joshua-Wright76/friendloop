import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  authorizeVideoForReply,
  removeVideoFor,
  removeWallPhotoFor,
  saveVideoFor,
  saveWallPhotoFor,
  saveWallVideoFor,
  sheetFor,
} from "../../src/lib/reply.ts";
import {
  deleteStoredVideo,
  isManagedBlobVideoUrl,
  listStoredVideos,
  readStoredVideo,
  storeVideoLocally,
  videoUploadMode,
} from "../../src/lib/video-storage.ts";
import { isMediaReferenced, purgeOrphanVideos, ORPHAN_VIDEO_AGE_MS } from "../../src/lib/media-cleanup.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { loadAlbum } from "../../src/lib/album.ts";
import { parseAlbumFilters } from "../../src/lib/album-query.ts";
import { replyLinkExport } from "../../src/lib/data-export.ts";
import { leaveLoop } from "../../src/lib/erasure.ts";
import { addSection } from "../support/items.ts";
import { videoUploadRefused } from "../../src/lib/upload-limit.ts";
import { LIMITS } from "../../src/lib/rate-limit-policy.ts";
import { resetDatabase, rows, seedDeliveredIssue, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { calls as blobCalls, failures as blobFailures, reset as resetBlob, stored as blobStore } from "../stubs/vercel-blob.mjs";

/*
 * Video clips: on a written answer (beside its words, photo and voice note) and
 * on a photo wall. The clip's bytes reach storage by themselves (straight to
 * Blob in production, through the app locally); what is tested here is
 * everything that happens around them.
 */

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  resetBlob();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const { sweep } = await import("../../src/lib/sweep.ts");

const UPLOADS = path.join(process.cwd(), "public", "uploads");
const MP4_HEAD = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypisom"), ...new Array(20).fill(0)]);
const local = (hex: string, extension = "mp4") => `/uploads/${hex.repeat(64)}.${extension}`;
const onDisk = (url: string) => path.join(UPLOADS, url.split("/").at(-1)!);

async function put(url: string, bytes: Uint8Array | string = "bytes") {
  await mkdir(UPLOADS, { recursive: true });
  await writeFile(onDisk(url), bytes);
}

/** A loop with a written question and a photo wall, and the round that asks both. */
async function openLoop() {
  const loop = await seedLoop();
  assert.deepEqual(await addSection({ groupId: loop.groupId, kind: "photo_wall", title: "Week in pictures" }), { ok: true });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [wall] = await rows<{ id: string; issue_id: string }>(
    "select iq.id, iq.issue_id from issue_questions iq join questions q on q.id = iq.question_id where q.text = 'Week in pictures'",
  );
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 and format = 'written' order by position limit 1",
    [wall.issue_id],
  );
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  return { loop, alice, bob, issueId: wall.issue_id, questionId: question.id, wallId: wall.id };
}

function inBlobMode(t: { after: (fn: () => void) => void }, token: string | undefined = "vercel_blob_rw_test") {
  const env = process.env.NODE_ENV;
  const e2e = process.env.E2E;
  const original = process.env.BLOB_READ_WRITE_TOKEN;
  t.after(() => {
    setEnv("NODE_ENV", env);
    setEnv("E2E", e2e);
    setEnv("BLOB_READ_WRITE_TOKEN", original);
  });
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", token);
}

test("locally a clip is kept on disk, read back by its first bytes, and removed", async () => {
  assert.equal(videoUploadMode(), "local");
  const hex = randomBytes(32).toString("hex");
  const url = await storeVideoLocally(MP4_HEAD, { contentType: "video/mp4", extension: "mp4" }, hex);
  assert.ok(url.endsWith(`/uploads/${hex}.mp4`));
  const read = await readStoredVideo(url);
  assert.equal(read?.size, MP4_HEAD.length);
  assert.deepEqual(read?.head, MP4_HEAD);

  await deleteStoredVideo(url);
  assert.equal(existsSync(onDisk(url)), false);
  // Gone already, someone else's, or not a URL at all: nothing to do, nothing thrown.
  await deleteStoredVideo(url);
  await deleteStoredVideo("https://stranger.example/uploads/" + "a".repeat(64) + ".mp4");
  await deleteStoredVideo("http://a b");
  assert.equal(await readStoredVideo(url), null, "a missing file reads as nothing");
  assert.equal(await readStoredVideo("https://stranger.example/clip.mp4"), null);
  assert.equal(await readStoredVideo("http://a b"), null);
  assert.deepEqual(await listStoredVideos(new Date(), 10), [], "nothing to sweep without a Blob store");
  assert.equal(blobCalls.del.length, 0);
});

test("in production a clip is read from Blob by its metadata and first bytes", async (t) => {
  inBlobMode(t);
  assert.equal(videoUploadMode(), "blob");
  const url = `https://store123.public.blob.vercel-storage.com/reply-videos/${"b".repeat(64)}.mp4`;
  assert.equal(isManagedBlobVideoUrl(url), true);
  assert.equal(isManagedBlobVideoUrl(url.replace("reply-videos", "reply-photos")), false);
  assert.equal(isManagedBlobVideoUrl(url.replace("https:", "http:")), false);
  assert.equal(isManagedBlobVideoUrl("not a url"), false);

  blobStore.push({ url, pathname: `reply-videos/${"b".repeat(64)}.mp4`, size: 12_345_678, contentType: "video/mp4", uploadedAt: new Date() });
  const realFetch = globalThis.fetch;
  const ranges: string[] = [];
  let answer = 206;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    ranges.push(new Headers(init?.headers).get("range") ?? "");
    return new Response(answer === 206 ? MP4_HEAD : null, { status: answer });
  }) as typeof fetch;

  const read = await readStoredVideo(url);
  assert.equal(read?.size, 12_345_678);
  assert.equal(read?.contentType, "video/mp4");
  assert.deepEqual(read?.head, MP4_HEAD);
  assert.deepEqual(ranges, ["bytes=0-31"], "only the first bytes are fetched");

  answer = 500;
  assert.equal(await readStoredVideo(url), null, "a store that won't serve it reads as nothing");
  assert.equal(await readStoredVideo(url.replace("b".repeat(64), "c".repeat(64))), null, "nor does a clip that isn't there");

  await deleteStoredVideo(url);
  assert.deepEqual(blobCalls.del.map((call) => call.url), [url]);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  await assert.rejects(deleteStoredVideo(url), /BLOB_READ_WRITE_TOKEN/);
});

test("a written answer takes a clip, swaps it for another, and lets it go", async () => {
  const { alice, questionId } = await openLoop();
  await put(local("1"));
  await put(local("2", "jpg"));
  await put(local("3"));
  await put(local("4", "jpg"));

  assert.deepEqual(await authorizeVideoForReply(alice.token, questionId), { ok: true, format: "written" });
  const first = await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("1"), posterUrl: local("2", "jpg"), durationMs: 41_000 });
  assert.equal(first.ok, true);
  const sheet = await sheetFor(alice.token);
  const item = sheet!.questions.find((question) => question.id === questionId)!;
  assert.deepEqual([item.videoUrl, item.videoPosterUrl, item.videoDurationMs], [local("1"), local("2", "jpg"), 41_000]);
  assert.equal(await isMediaReferenced(local("1")), true);
  assert.equal(await isMediaReferenced(local("2", "jpg")), true);

  // Saving the same clip again keeps its files.
  assert.equal((await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("1"), posterUrl: local("2", "jpg"), durationMs: 41_000 })).ok, true);
  assert.equal(existsSync(onDisk(local("1"))), true);

  // A new clip replaces the old one, and the old files go.
  assert.equal((await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("3"), posterUrl: local("4", "jpg"), durationMs: 9_000 })).ok, true);
  assert.equal(existsSync(onDisk(local("1"))), false);
  assert.equal(existsSync(onDisk(local("2", "jpg"))), false);

  assert.equal((await removeVideoFor({ token: alice.token, issueQuestionId: questionId })).ok, true);
  const [row] = await rows<{ video_url: string | null; video_poster_url: string | null; video_duration_ms: number | null }>(
    "select video_url, video_poster_url, video_duration_ms from replies where membership_id = $1 and issue_question_id = $2",
    [alice.id, questionId],
  );
  assert.deepEqual(row, { video_url: null, video_poster_url: null, video_duration_ms: null });
  assert.equal(existsSync(onDisk(local("3"))), false);
  assert.equal(existsSync(onDisk(local("4", "jpg"))), false);
  assert.equal((await removeVideoFor({ token: alice.token, issueQuestionId: questionId })).ok, true, "nothing left to remove is fine");
});

test("a clip someone else attached can't be claimed, and only written answers and walls take clips", async () => {
  const { alice, bob, questionId, wallId } = await openLoop();
  assert.equal((await saveVideoFor({ token: bob.token, issueQuestionId: questionId, videoUrl: local("5"), posterUrl: local("6", "jpg"), durationMs: 1000 })).ok, true);
  const stolen = await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("5"), posterUrl: local("7", "jpg"), durationMs: 1000 });
  assert.deepEqual(stolen, { ok: false, status: 409, error: "We couldn't upload that video. Try again." });
  const stolenOnWall = await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("5"), posterUrl: local("7", "jpg"), durationMs: 1000, caption: "", position: 0 });
  assert.equal(stolenOnWall.ok, false);

  assert.deepEqual(await authorizeVideoForReply(alice.token, wallId), { ok: true, format: "photo_wall" });
  const wrong = await saveVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("8"), posterUrl: local("9", "jpg"), durationMs: 1000 });
  assert.equal(wrong.ok, false, "a wall's clips are wall items, not the answer's own");
  const notWall = await saveWallVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("8"), posterUrl: local("9", "jpg"), durationMs: 1000, caption: "", position: 0 });
  assert.equal(notWall.ok, false);

  const unknown = await authorizeVideoForReply("not-a-token", questionId);
  assert.equal(unknown.ok, false);
  assert.equal((await removeVideoFor({ token: "not-a-token", issueQuestionId: questionId })).ok, false);

  // A card copied from a section never took voice notes, and takes no clips either.
  await rows("update issue_questions set from_section = true where id = $1", [questionId]);
  assert.deepEqual(await authorizeVideoForReply(alice.token, questionId), { ok: false, status: 409, error: "That question isn't in this round." });
  const copied = await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("8"), posterUrl: local("9", "jpg"), durationMs: 1000 });
  assert.equal(copied.ok, false);
});

test("a photo wall takes two clips among its six, and taking one off removes its files", async () => {
  const { alice, wallId } = await openLoop();
  const png = new Uint8Array((await import("../../e2e/support/audio.ts")).makePng());
  for (const hex of ["a", "b", "c", "d"]) await put(local(hex));

  const first = await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("a"), posterUrl: local("b", "jpg"), durationMs: 12_000, caption: "  The ferry  ", position: 0 });
  assert.ok(first.ok && first.mediaId);
  assert.equal((await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("c"), posterUrl: local("e", "jpg"), durationMs: 3_000, caption: "", position: 1 })).ok, true);
  const third = await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("d"), posterUrl: local("f", "jpg"), durationMs: 3_000, caption: "", position: 2 });
  assert.deepEqual(third, { ok: false, status: 409, error: "A photo wall takes two videos from each person, and you've added both." });

  const sheet = await sheetFor(alice.token);
  const wall = sheet!.questions.find((question) => question.id === wallId)!;
  assert.deepEqual(wall.media.map((item) => [item.caption, item.videoUrl, item.videoDurationMs]), [
    ["The ferry", local("a"), 12_000],
    [null, local("c"), 3_000],
  ]);

  for (let position = 2; position < 6; position += 1) {
    assert.equal((await saveWallPhotoFor({ token: alice.token, issueQuestionId: wallId, bytes: png, contentType: "image/png", caption: "", position })).ok, true);
  }
  // Six already: the wall is full before the two-clip rule comes into it.
  const full = await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("d"), posterUrl: local("f", "jpg"), durationMs: 3_000, caption: "", position: 5 });
  assert.deepEqual(full, { ok: false, status: 409, error: "A photo wall holds six photos or videos, and this one is full." });

  assert.equal((await removeWallPhotoFor({ token: alice.token, issueQuestionId: wallId, mediaId: first.mediaId! })).ok, true);
  assert.equal(existsSync(onDisk(local("a"))), false, "the clip goes with its wall item");
});

test("a clip whose file won't go still comes off the answer", async (t) => {
  const { alice, questionId } = await openLoop();
  await put(local("1"));
  assert.equal((await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("1"), posterUrl: local("2", "jpg"), durationMs: 1000 })).ok, true);
  await chmod(UPLOADS, 0o500);
  t.after(async () => { await chmod(UPLOADS, 0o755).catch(() => undefined); });
  assert.equal((await removeVideoFor({ token: alice.token, issueQuestionId: questionId })).ok, true);
  const [row] = await rows<{ video_url: string | null }>("select video_url from replies where membership_id = $1 and issue_question_id = $2", [alice.id, questionId]);
  assert.equal(row.video_url, null);
});

test("a clip alone is an answer: the round, the album and the export all carry it", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [{ email: alice.email, body: "placeholder" }] });
  await rows(
    "update replies set body = '', video_url = $1, video_poster_url = $2, video_duration_ms = 42000 where issue_id = $3",
    [local("1"), local("2", "jpg"), delivered.issueId],
  );

  const view = await loadIssue({ issueId: delivered.issueId, viewerMembershipId: alice.id });
  const answer = view!.blocks.flatMap((block) => block.answers)[0];
  assert.deepEqual(answer.video, { url: local("1"), posterUrl: local("2", "jpg"), durationMs: 42000 });

  const album = await loadAlbum({ groupId: loop.groupId, viewerMembershipId: alice.id, viewerIsAdmin: false, filters: parseAlbumFilters({}) });
  const items = album.groups.flatMap((group) => group.items);
  assert.deepEqual(items.map((item) => [item.kind, item.url, item.posterUrl, item.durationMs]), [["video", local("1"), local("2", "jpg"), 42000]]);

  const exported = await replyLinkExport(alice.token, E2E_NOW);
  let text = "";
  for await (const chunk of exported!.chunks) text += chunk;
  const answers = JSON.parse(text).loops[0].answers as Array<{ video?: { url: string; posterUrl: string; durationMs: number } }>;
  assert.equal(answers[0].video?.durationMs, 42000);
  assert.match(answers[0].video!.url, /\/uploads\/1{64}\.mp4$/);
  assert.match(answers[0].video!.posterUrl, /\/uploads\/2{64}\.jpg$/);
});

test("a wall clip shows as a clip in the round and the album, and as a link in the export", async () => {
  const { loop, alice, wallId, issueId } = await openLoop();
  await put(local("a"));
  await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("a"), posterUrl: local("b", "jpg"), durationMs: 5_000, caption: "Waves", position: 0 });
  await rows("update issues set status = 'delivered', delivered_at = $1 where id = $2", [DELIVERY_DAY, issueId]);

  const view = await loadIssue({ issueId, viewerMembershipId: alice.id });
  const media = view!.blocks.find((block) => block.questionId === wallId)!.answers[0].media;
  assert.deepEqual(media, [{ url: local("b", "jpg"), caption: "Waves", videoUrl: local("a"), videoDurationMs: 5_000 }]);

  const album = await loadAlbum({ groupId: loop.groupId, viewerMembershipId: alice.id, viewerIsAdmin: false, filters: parseAlbumFilters({}) });
  const [item] = album.groups.flatMap((group) => group.items);
  assert.deepEqual([item.kind, item.url, item.posterUrl, item.caption], ["video", local("a"), local("b", "jpg"), "Waves"]);

  const exported = await replyLinkExport(alice.token, E2E_NOW);
  let text = "";
  for await (const chunk of exported!.chunks) text += chunk;
  const answers = JSON.parse(text).loops[0].answers as Array<{ photos?: Array<{ videoUrl?: string }> }>;
  assert.match(answers.find((entry) => entry.photos)!.photos![0].videoUrl!, /\/uploads\/a{64}\.mp4$/);
});

test("leaving a loop takes the person's clips and stills with them", async () => {
  const { alice, questionId, wallId } = await openLoop();
  for (const url of [local("1"), local("2", "jpg"), local("3"), local("4", "jpg")]) await put(url);
  await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: local("1"), posterUrl: local("2", "jpg"), durationMs: 1000 });
  await saveWallVideoFor({ token: alice.token, issueQuestionId: wallId, videoUrl: local("3"), posterUrl: local("4", "jpg"), durationMs: 1000, caption: "", position: 0 });

  assert.equal((await leaveLoop(alice.token)).ok, true);
  for (const url of [local("1"), local("2", "jpg"), local("3"), local("4", "jpg")]) {
    assert.equal(existsSync(onDisk(url)), false, url);
  }
});

test("the sweep removes clips a closed browser left unattached, and only those", async (t) => {
  inBlobMode(t);
  const { alice, questionId } = await openLoop();
  const at = new Date(AFTER_FIRST_SLOT.getTime() + 2 * ORPHAN_VIDEO_AGE_MS);
  const old = new Date(at.getTime() - ORPHAN_VIDEO_AGE_MS - 60_000);
  const blob = (hex: string, uploadedAt: Date) => {
    const pathname = `reply-videos/${hex.repeat(64)}.mp4`;
    return { url: `https://store123.public.blob.vercel-storage.com/${pathname}`, pathname, size: 10, contentType: "video/mp4", uploadedAt };
  };
  const attached = blob("a", old);
  const orphan = blob("b", old);
  const fresh = blob("c", new Date(at.getTime() - 60_000));
  const another = blob("d", old);
  blobStore.push(attached, orphan, fresh, another);
  await saveVideoFor({ token: alice.token, issueQuestionId: questionId, videoUrl: attached.url, posterUrl: local("e", "jpg"), durationMs: 1000 });

  // One delete fails, the way a Blob outage would: the other still goes, and the sweep tries again later.
  blobFailures.del = 1;
  assert.equal(await purgeOrphanVideos(at), 1);
  assert.deepEqual(blobCalls.del.map((call) => call.url), [another.url]);
  assert.equal(await purgeOrphanVideos(at), 1, "the one that failed goes next time");
  assert.deepEqual(blobCalls.del.map((call) => call.url), [another.url, orphan.url]);
  assert.deepEqual(await listStoredVideos(new Date(at.getTime() - ORPHAN_VIDEO_AGE_MS), 1), [attached.url], "the batch stops at its limit");

  blobFailures.list = 1;
  assert.equal(await purgeOrphanVideos(at), 0, "a store that won't list is tried again next sweep");
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  await assert.rejects(listStoredVideos(at, 10), /BLOB_READ_WRITE_TOKEN/);
});

test("one link can send a handful of clips an hour, fewer than photos", async () => {
  const { alice } = await openLoop();
  for (let sent = 0; sent < LIMITS.videoUpload.max; sent += 1) {
    assert.equal(await videoUploadRefused(alice.token), false);
  }
  assert.equal(await videoUploadRefused(alice.token), true);
  assert.ok(LIMITS.videoUpload.max < LIMITS.upload.max);
});

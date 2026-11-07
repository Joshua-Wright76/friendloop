import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { getNow, nowFromEnv } from "../../src/lib/clock.ts";
import { e2eSeamsAllowed } from "../../src/lib/e2e.ts";
import { emailPreviews } from "../../src/lib/email/previews.ts";
import { deleteStoredPhoto, isManagedBlobPhotoUrl, storePhoto } from "../../src/lib/photo-storage.ts";
import {
  PREVIEW_LOOKS,
  enableUiPreview,
  wearPreviewLook,
  isConstraintViolation,
  isLocalUiPreview,
  previewCookieMatches,
  previewCookieName,
  previewCookieValue,
  previewKeyMatches,
  previewSecret,
  requireUiPreview,
  UI_PREVIEW,
  unlockUiInbox,
} from "../../src/lib/ui-preview.ts";
import { resetDatabase, rows, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { E2E_NOW } from "../../e2e/support/clock.ts";
import {
  clearRequest,
  cookieEntries,
  setRequestBroken,
  setRequestCookies,
  setRequestHeaders,
} from "../stubs/request.mjs";
import { calls as blobCalls, reset as resetBlob } from "../stubs/vercel-blob.mjs";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const JPEG_FORMAT = { contentType: "image/jpeg", extension: "jpg" } as const;

beforeEach(async () => {
  await resetDatabase();
  resetBlob();
  clearRequest();
  setRequestBroken(false);
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

// ── clock ────────────────────────────────────────────────────


setupDatabase();

test("the clock survives being read outside a request", async () => {
  (globalThis as { __CONNECTION_BROKEN__?: boolean }).__CONNECTION_BROKEN__ = true;
  setRequestBroken(true);
  try {
    const at = await getNow();
    assert.ok(Math.abs(at.getTime() - Date.now()) < 5_000);
  } finally {
    (globalThis as { __CONNECTION_BROKEN__?: boolean }).__CONNECTION_BROKEN__ = false;
    setRequestBroken(false);
  }
});

test("the clock override is refused on a production deployment", async () => {
  const original = process.env.VERCEL_ENV;
  try {
    process.env.VERCEL_ENV = "production";
    assert.equal(e2eSeamsAllowed(), false);
    setRequestHeaders({ "x-e2e-now": "2020-01-01T00:00:00.000Z" });
    const at = await getNow();
    assert.ok(at.getFullYear() > 2020, "the header is ignored where it would matter");
  } finally {
    if (original === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = original;
  }
});

test("scripts can pin the clock through the environment", () => {
  const original = process.env.E2E_NOW;
  try {
    process.env.E2E_NOW = "2026-01-02T08:05:00.000Z";
    assert.equal(nowFromEnv().toISOString(), E2E_NOW.toISOString());

    process.env.E2E_NOW = "not-a-date";
    assert.ok(Math.abs(nowFromEnv().getTime() - Date.now()) < 5_000);

    delete process.env.E2E_NOW;
    assert.ok(Math.abs(nowFromEnv().getTime() - Date.now()) < 5_000);
  } finally {
    if (original === undefined) delete process.env.E2E_NOW;
    else process.env.E2E_NOW = original;
  }
});

// ── email previews ───────────────────────────────────────────

test("every email the product sends has a preview", () => {
  const previews = emailPreviews();
  assert.deepEqual(
    previews.map((preview) => preview.id).sort(),
    [
      "delivery",
      "deliveryShared",
      "deliveryThemed",
      "inviteContributor",
      "inviteReader",
      "mention",
      "paused",
      "prompt",
      "reminder",
      "signIn",
    ],
  );
  for (const preview of previews) {
    assert.ok(preview.email.subject.length > 0, `${preview.id} has a subject`);
    assert.ok(preview.email.html.includes("<!doctype html>"), `${preview.id} is a document`);
    assert.ok(preview.email.text.length > 0, `${preview.id} has a plain-text body`);
  }
  const themed = previews.find((preview) => preview.id === "deliveryThemed")!;
  assert.match(themed.email.subject, /Camping weekend/);
  assert.match(themed.email.html, /#eef3fb/);
});

// ── photo storage ────────────────────────────────────────────

test("development photos are written to the public folder", async () => {
  const url = await storePhoto(JPEG, JPEG_FORMAT);
  assert.match(url, /^http:\/\/localhost:3100\/uploads\/[a-f0-9]{64}\.jpg$/);
  const filename = path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!);
  assert.equal(existsSync(filename), true);

  await deleteStoredPhoto(url);
  assert.equal(existsSync(filename), false);
});

test("production photos go to the blob store, and need its token", async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  const originalE2E = process.env.E2E;
  t.after(() => {
    setEnv("NODE_ENV", originalEnv);
    if (originalE2E === undefined) delete process.env.E2E;
    else process.env.E2E = originalE2E;
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  // This contract is for the deployed app alone; the e2e build stores on disk
  // instead, so the flag comes off while the production path is under test.
  setEnv("NODE_ENV", "production");
  delete process.env.E2E;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(storePhoto(JPEG, JPEG_FORMAT), /BLOB_READ_WRITE_TOKEN/);

  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test";
  const url = await storePhoto(JPEG, JPEG_FORMAT);
  assert.match(url, /^https:\/\/.+\.public\.blob\.vercel-storage\.com\/reply-photos\/[a-f0-9]{64}\.jpg$/);
  const [upload] = blobCalls.put as Array<{
    options: { contentType: string; addRandomSuffix: boolean };
  }>;
  assert.equal(blobCalls.put.length, 1);
  assert.equal(upload.options.contentType, "image/jpeg");
  assert.equal(upload.options.addRandomSuffix, false);

  await deleteStoredPhoto(url);
  assert.equal(blobCalls.del.length, 1);

  // Without a token there is no way to remove a production photo.
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(deleteStoredPhoto(url), /BLOB_READ_WRITE_TOKEN/);
});

test("deleting a photo ignores anything that is not ours", async () => {
  await deleteStoredPhoto("not a url at all");
  await deleteStoredPhoto("https://example.com/somebody-elses.jpg");
  await deleteStoredPhoto("http://localhost:3100/uploads/not-a-hash.jpg");
  assert.deepEqual(blobCalls.del, []);
});

test("managed blob urls are recognised, and lookalikes are not", () => {
  assert.equal(
    isManagedBlobPhotoUrl(
      "https://store123.public.blob.vercel-storage.com/reply-photos/" + "a".repeat(64) + ".jpg",
    ),
    true,
  );
  assert.equal(isManagedBlobPhotoUrl("https://evil.example/reply-photos/" + "a".repeat(64) + ".jpg"), false);
  assert.equal(isManagedBlobPhotoUrl("not a url"), false);
});

// ── ui preview ───────────────────────────────────────────────

test("the preview gate opens in local development and needs a key anywhere else", (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL_ENV;
  t.after(() => {
    setEnv("NODE_ENV", originalEnv);
    if (originalVercel === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercel;
  });

  setEnv("NODE_ENV", "development");
  delete process.env.VERCEL_ENV;
  assert.equal(isLocalUiPreview(), true);

  setEnv("NODE_ENV", "production");
  assert.equal(isLocalUiPreview(), false);

  setEnv("NODE_ENV", "development");
  process.env.VERCEL_ENV = "preview";
  assert.equal(isLocalUiPreview(), false);
});

test("the preview key is compared hashed, and a missing secret locks everything", () => {
  const original = process.env.UI_PREVIEW_SECRET;
  try {
    delete process.env.UI_PREVIEW_SECRET;
    assert.equal(previewSecret(), null);
    assert.equal(previewCookieValue(), null);
    assert.equal(previewKeyMatches("anything"), false);
    assert.equal(previewCookieMatches("anything"), false);

    process.env.UI_PREVIEW_SECRET = "  s3cret  ";
    assert.equal(previewSecret(), "s3cret");
    assert.equal(previewKeyMatches("s3cret"), true);
    assert.equal(previewKeyMatches("wrong"), false);
    assert.equal(previewKeyMatches(null), false);

    const cookie = previewCookieValue()!;
    assert.notEqual(cookie, "s3cret", "the cookie never carries the secret");
    assert.equal(previewCookieMatches(cookie), true);
    assert.equal(previewCookieMatches("wrong"), false);
    assert.equal(previewCookieMatches(undefined), false);
  } finally {
    if (original === undefined) delete process.env.UI_PREVIEW_SECRET;
    else process.env.UI_PREVIEW_SECRET = original;
  }
});

test("unlocking the inbox sets a scoped cookie only for the right key", async (t) => {
  const original = process.env.UI_PREVIEW_SECRET;
  t.after(() => {
    if (original === undefined) delete process.env.UI_PREVIEW_SECRET;
    else process.env.UI_PREVIEW_SECRET = original;
  });
  process.env.UI_PREVIEW_SECRET = "s3cret";

  await unlockUiInbox("wrong");
  assert.equal(cookieEntries().length, 0);

  await unlockUiInbox("s3cret");
  const cookies = cookieEntries();
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, previewCookieName());
  assert.equal(cookies[0].value, previewCookieValue());

  // Already unlocked: nothing is written twice.
  setRequestCookies({ [previewCookieName()]: previewCookieValue()! });
  await unlockUiInbox("s3cret");
  assert.equal(cookieEntries().length, 1);

  delete process.env.UI_PREVIEW_SECRET;
  await unlockUiInbox("s3cret");
  assert.equal(cookieEntries().length, 1, "no secret, no unlock");
});

test("the inbox gate answers 404 unless the cookie matches", async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalSecret = process.env.UI_PREVIEW_SECRET;
  t.after(() => {
    setEnv("NODE_ENV", originalEnv);
    if (originalSecret === undefined) delete process.env.UI_PREVIEW_SECRET;
    else process.env.UI_PREVIEW_SECRET = originalSecret;
  });

  setEnv("NODE_ENV", "development");
  delete process.env.VERCEL_ENV;
  await requireUiPreview();

  setEnv("NODE_ENV", "production");
  process.env.UI_PREVIEW_SECRET = "s3cret";
  clearRequest();
  await assert.rejects(requireUiPreview(), (error: Error & { digest?: string }) => {
    assert.equal(error.digest, "NEXT_HTTP_ERROR_FALLBACK;404");
    return true;
  });

  setRequestCookies({ [previewCookieName()]: previewCookieValue()! });
  await requireUiPreview();
});

test("production never seeds the demo or signs anyone in as its owner", async () => {
  const before = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = "production";
  try {
    assert.equal(await enableUiPreview(), false);
    assert.equal(await enableUiPreview(true), false);
  } finally {
    if (before === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = before;
  }
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from groups"))[0].count, 0);
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from sessions"))[0].count, 0);
});

test("the preview seeds one loop, and can rebuild it from scratch", async () => {
  await enableUiPreview();
  const afterFirst = await rows<{ count: number }>("select count(*)::int as count from groups");
  assert.equal(afterFirst[0].count, 1);

  const loops = await rows<{ id: string; is_synthetic: boolean }>("select id, is_synthetic from groups");
  assert.equal(loops[0].id, UI_PREVIEW.groupId);
  assert.equal(loops[0].is_synthetic, true);

  // A signed-in preview session is part of the seed.
  const cookies = cookieEntries();
  assert.equal(cookies.length, 1);

  const issues = await rows<{ status: string }>("select status from issues order by status");
  assert.deepEqual(issues.map((row) => row.status).sort(), ["delivered", "open"]);

  // Running it again is idempotent; resetting rebuilds it.
  await enableUiPreview();
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from groups"))[0].count, 1);

  // Tables with no natural unique key (section_media) must not grow per visit.
  const media = async () =>
    (await rows<{ count: number }>("select count(*)::int as count from section_media"))[0].count;
  assert.equal(await media(), 2);

  await enableUiPreview(true);
  assert.equal(await media(), 2);
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from groups"))[0].count, 1);
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from memberships"))[0].count, 3, "Alex, Alice, and Sam");
});

test("the preview rebuilds itself when an older seed left rows it cannot top up", async () => {
  await enableUiPreview();

  // Older seeds gave replies generated ids. replies_unique_idx then swallows the
  // current seed's insert, and the comments that hang from its fixed id have no parent.
  await rows("delete from comments");
  await rows("delete from reactions");
  await rows("update replies set id = gen_random_uuid()");

  await enableUiPreview();

  const threaded = await rows<{ count: number }>(
    "select count(*)::int as count from comments c join replies r on r.id = c.reply_id",
  );
  assert.ok(threaded[0].count > 0, "the seed's comments are back, on the seed's own replies");
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from groups"))[0].count, 1);
  assert.ok(cookieEntries().length > 0, "the rebuilt preview still signs you in");
});

test("rebuilding the preview leaves other loops and the demo user's place in them alone", async () => {
  const other = await seedLoop();
  await enableUiPreview();
  await rows("update memberships set user_id = $1 where group_id = $2 and access = 'owner'", [UI_PREVIEW.userId, other.groupId]);
  await rows("delete from comments");
  await rows("delete from reactions");
  await rows("update replies set id = gen_random_uuid()");

  await enableUiPreview();

  const owners = await rows<{ user_id: string }>("select user_id from memberships where group_id = $1 and access = 'owner'", [other.groupId]);
  assert.deepEqual(owners.map((row) => row.user_id), [UI_PREVIEW.userId]);
});

test("only an integrity error is a reason to rebuild the preview", () => {
  // Drizzle's wrapper, the bare driver error, then everything that says nothing about the data.
  assert.equal(isConstraintViolation({ cause: { code: "23503" } }), true);
  assert.equal(isConstraintViolation({ code: "23505" }), true);
  assert.equal(isConstraintViolation({ cause: { code: "40001" } }), false, "serialization failure");
  assert.equal(isConstraintViolation({ cause: { code: "57014" } }), false, "statement timeout");
  assert.equal(isConstraintViolation({ cause: { code: "ECONNRESET" } }), false);
  assert.equal(isConstraintViolation(new TypeError("boom")), false);
  assert.equal(isConstraintViolation(null), false);
});

test("a local photo that cannot be unlinked is an error worth hearing about", async () => {
  const { mkdir, rmdir } = await import("node:fs/promises");
  const filename = path.join(process.cwd(), "public", "uploads", "d".repeat(64) + ".jpg");
  // A directory where a file is expected: unlink fails with something other
  // than ENOENT, and that is not silently swallowed.
  await mkdir(filename, { recursive: true });
  try {
    await assert.rejects(
      deleteStoredPhoto(`http://localhost:3100/uploads/${"d".repeat(64)}.jpg`),
      (error: NodeJS.ErrnoException) => error.code !== "ENOENT",
    );
  } finally {
    await rmdir(filename).catch(() => undefined);
  }
});

test("an unparseable app url makes photo deletion a no-op, not a crash", async (t) => {
  const original = process.env.NEXT_PUBLIC_APP_URL;
  t.after(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = original;
  });

  process.env.NEXT_PUBLIC_APP_URL = "http://";
  await deleteStoredPhoto("http://localhost:3100/uploads/" + "e".repeat(64) + ".jpg");
  assert.deepEqual(blobCalls.del, []);
});

test("the demo loop shows the new looks, and can try on any outfit without touching another loop", async () => {
  const other = await seedLoop({ name: "Someone else's loop" });
  await enableUiPreview();
  const columns = "theme_preset, theme_background, theme_paper_pack, theme_tape_pack, theme_mascot";
  const demo = async () => (await rows<Record<string, string | null>>(`select ${columns} from groups where id = $1`, [UI_PREVIEW.groupId]))[0];

  assert.deepEqual(await demo(), { theme_preset: "bluebell", theme_background: "stars", theme_paper_pack: "journal", theme_tape_pack: "seaside", theme_mascot: "duck" });
  const people = await rows<{ charm: string | null; avatar_frame: string | null }>("select charm, avatar_frame from memberships where group_id = $1 and charm is not null", [UI_PREVIEW.groupId]);
  assert.equal(people.length, 3);
  const chips = await rows<{ emoji: string }>("select distinct emoji from reactions");
  assert.ok(chips.some((chip) => chip.emoji === "🪿"), "a reaction past the three defaults");

  assert.equal(await wearPreviewLook("schoolbook"), true);
  assert.deepEqual(await demo(), { theme_preset: null, theme_background: "hearts", theme_paper_pack: "schoolbook", theme_tape_pack: "garden", theme_mascot: "frog" });

  assert.equal(await wearPreviewLook("original"), true);
  assert.deepEqual(await demo(), { theme_preset: null, theme_background: null, theme_paper_pack: null, theme_tape_pack: null, theme_mascot: null });

  for (const key of Object.keys(PREVIEW_LOOKS)) assert.equal(await wearPreviewLook(key), true, key);
  for (const bad of [null, "", "nope", "constructor", "__proto__"]) assert.equal(await wearPreviewLook(bad), false, String(bad));

  const [untouched] = await rows<Record<string, string | null>>(`select ${columns} from groups where id = $1`, [other.groupId]);
  assert.ok(Object.values(untouched).every((value) => value === null));
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  clearHeaderImage,
  clearMemberPhoto,
  renameIssue,
  saveTheme,
  setHeaderImage,
  setMemberPhoto,
} from "../../src/lib/identity.ts";
import { transferOwnership } from "../../src/lib/manage.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { postComment } from "../../src/lib/comments.ts";
import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES } from "../../src/lib/photo-validation.ts";
import {
  AFTER_FIRST_SLOT,
  DELIVERY_DAY,
  E2E_NOW,
  addMember,
  groupOf,
  resetDatabase,
  rows,
  seedDeliveredIssue,
  seedLoop,
  seedOpenIssue,
  seedReplies,
  setEnv,
  setupDatabase,
} from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const file = (url: string) => path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!);

/* ------------------------------- themes ------------------------------- */

test("a loop's stationery is stored, and Gingham with no accent is stored as nothing", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Another loop" });

  assert.deepEqual(await saveTheme(loop.groupId, { preset: "bluebell", accent: "#2F5FB5" }), { ok: true, adjusted: false });
  let group = await groupOf(loop.groupId);
  assert.deepEqual([group.themePreset, group.themeAccent], ["bluebell", "#2f5fb5"]);
  assert.equal((await groupOf(other.groupId)).themePreset, null, "another loop is untouched");

  assert.deepEqual(await saveTheme(loop.groupId, { preset: "gingham", accent: "" }), { ok: true, adjusted: false });
  group = await groupOf(loop.groupId);
  assert.deepEqual([group.themePreset, group.themeAccent], [null, null]);

  assert.deepEqual(await saveTheme(loop.groupId, { preset: "", accent: "#fff" }), { ok: true, adjusted: true });
  assert.equal((await groupOf(loop.groupId)).themeAccent, "#ffffff");
});

test("an unknown paper or an unreadable accent code is refused and changes nothing", async () => {
  const loop = await seedLoop();
  await saveTheme(loop.groupId, { preset: "meadow", accent: "" });

  assert.deepEqual(await saveTheme(loop.groupId, { preset: "comic-sans", accent: "" }), { ok: false, error: "preset" });
  assert.deepEqual(await saveTheme(loop.groupId, { preset: "meadow", accent: "javascript:alert(1)" }), { ok: false, error: "accent" });
  assert.deepEqual(await saveTheme(loop.groupId, { preset: "meadow", accent: "red" }), { ok: false, error: "accent" });
  assert.equal((await groupOf(loop.groupId)).themePreset, "meadow");
  assert.equal((await groupOf(loop.groupId)).themeAccent, null);
});

test("a header picture is stored, replaced without leaving the old file, and cleared", async (t) => {
  const loop = await seedLoop();
  const first = await setHeaderImage(loop.groupId, { bytes: PNG, type: "image/png" });
  assert.ok(first.ok);
  t.after(async () => {
    const { deleteStoredPhoto } = await import("../../src/lib/photo-storage.ts");
    await deleteStoredPhoto(first.url);
  });
  assert.ok(existsSync(file(first.url)));
  assert.equal((await groupOf(loop.groupId)).headerImageUrl, first.url);

  const second = await setHeaderImage(loop.groupId, { bytes: PNG, type: "image/png" });
  assert.ok(second.ok);
  assert.notEqual(second.url, first.url);
  assert.ok(!existsSync(file(first.url)), "the replaced file is gone");
  assert.ok(existsSync(file(second.url)));

  await clearHeaderImage(loop.groupId);
  assert.equal((await groupOf(loop.groupId)).headerImageUrl, null);
  assert.ok(!existsSync(file(second.url)));
  await clearHeaderImage(loop.groupId);
});

test("a header picture must be a real image under its own cap, for a loop that exists", async (t) => {
  const loop = await seedLoop();
  const text = await setHeaderImage(loop.groupId, { bytes: new TextEncoder().encode("not an image"), type: "image/png" });
  assert.deepEqual(text, { ok: false, status: 415, error: "Use a JPEG, PNG, WebP or GIF picture." });
  const mismatch = await setHeaderImage(loop.groupId, { bytes: PNG, type: "image/jpeg" });
  assert.equal(mismatch.ok === false && mismatch.status, 415);

  const big = new Uint8Array(MAX_BANNER_BYTES + 1);
  big.set(PNG);
  const tooBig = await setHeaderImage(loop.groupId, { bytes: big, type: "image/png" });
  assert.deepEqual(tooBig, { ok: false, status: 413, error: "That picture is over 4 MB. Try a smaller one." });
  assert.equal((await groupOf(loop.groupId)).headerImageUrl, null);

  const { readdir } = await import("node:fs/promises");
  const before = (await readdir(path.join(process.cwd(), "public", "uploads"))).length;
  const missing = await setHeaderImage("00000000-0000-4000-8000-000000000000", { bytes: PNG, type: "image/png" });
  assert.equal(missing.ok === false && missing.status, 404);
  assert.equal((await readdir(path.join(process.cwd(), "public", "uploads"))).length, before, "no orphan file is left behind");

  const original = { NODE_ENV: process.env.NODE_ENV, E2E: process.env.E2E, TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
  t.after(() => {
    setEnv("NODE_ENV", original.NODE_ENV);
    setEnv("E2E", original.E2E);
    setEnv("BLOB_READ_WRITE_TOKEN", original.TOKEN);
    console.error = originalError;
  });
  const originalError = console.error;
  console.error = () => undefined;
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  const failed = await setHeaderImage(loop.groupId, { bytes: PNG, type: "image/png" });
  assert.deepEqual(failed, { ok: false, status: 500, error: "That picture didn't save. Try again in a moment." });
});

/* ---------------------------- issue names ---------------------------- */

test("an owner names a round, clears the name, and cannot reach another loop's round", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Another loop" });
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });

  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "  Camping   weekend "), { ok: true, name: "Camping weekend" });
  const [row] = await rows<{ name: string | null }>("select name from issues where id = $1", [issue.issueId]);
  assert.equal(row.name, "Camping weekend");

  assert.deepEqual(await renameIssue(other.groupId, issue.issueId, "Hijacked"), { ok: false });
  assert.equal((await rows<{ name: string }>("select name from issues where id = $1", [issue.issueId]))[0].name, "Camping weekend");

  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "   "), { ok: true, name: null });
  assert.equal((await rows<{ name: string | null }>("select name from issues where id = $1", [issue.issueId]))[0].name, null);
});

test("delivery carries the round's name and the loop's stationery into the email", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "The cat." }],
    submittedAt: AFTER_FIRST_SLOT,
  });
  await saveTheme(loop.groupId, { preset: "lilac", accent: "" });
  await rows("update groups set header_image_url = 'https://cdn.test/banner.png' where id = $1", [loop.groupId]);
  await renameIssue(loop.groupId, issue.issueId, "Camping weekend");

  await sweep({ at: DELIVERY_DAY });

  const [mail] = await rows<{ subject: string; html: string }>(
    "select subject, html from outbox where kind = 'delivery' order by \"to\" limit 1",
  );
  assert.match(mail.subject, /· Camping weekend$/);
  assert.match(mail.html, /#f5f0fb/, "the lilac paper");
  assert.match(mail.html, /<img src="https:\/\/cdn\.test\/banner\.png" alt=""/);
});

test("prompt, reminder and nudge emails wear the stationery; an untouched loop stays Gingham", async () => {
  const themed = await seedLoop();
  await saveTheme(themed.groupId, { preset: "marmalade", accent: "" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const prompts = await rows<{ html: string }>("select html from outbox where kind = 'prompt'");
  assert.ok(prompts.length > 0);
  for (const prompt of prompts) assert.match(prompt.html, /#fff3e0/);

  await resetDatabase();
  const plain = await seedLoop();
  void plain;
  await sweep({ at: AFTER_FIRST_SLOT });
  const gingham = await rows<{ html: string }>("select html from outbox where kind = 'prompt'");
  assert.ok(gingham.length > 0);
  for (const prompt of gingham) {
    assert.match(prompt.html, /#fff3f5/);
    assert.doesNotMatch(prompt.html, /<img /);
  }
});

test("the web issue exposes the round's name and each author's photo", async (t) => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Alice's answer." }],
  });
  const photo = await setMemberPhoto(loop.members.find((member) => member.email.startsWith("alice"))!.id, { bytes: PNG, type: "image/png" });
  assert.ok(photo.ok);
  t.after(() => clearMemberPhoto(loop.members.find((member) => member.email.startsWith("alice"))!.id));
  await renameIssue(loop.groupId, issue.issueId, "Camping weekend");

  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: null });
  assert.equal(view?.issue.name, "Camping weekend");
  assert.equal(view?.blocks[0].answers[0].authorPhotoUrl, photo.url);

  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await postComment({ issueId: issue.issueId, viewerToken: bob.token, body: "Nice." });
  const withComments = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  assert.equal(withComments?.comments[0].authorPhotoUrl, null);
  assert.equal(withComments?.mentionables.find((person) => person.name.toLowerCase().startsWith("alice"))?.photoUrl, photo.url);
});

/* --------------------------- profile photos --------------------------- */

test("a photo belongs to one membership: it replaces cleanly, clears, and never follows the email", async (t) => {
  const loop = await seedLoop();
  const elsewhere = await seedLoop({ name: "Another loop", members: [{ email: "alice@friendloop.test", access: "owner" }] });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const first = await setMemberPhoto(alice.id, { bytes: PNG, type: "image/png" });
  assert.ok(first.ok);
  t.after(() => clearMemberPhoto(alice.id));
  assert.ok(existsSync(file(first.url)));

  const second = await setMemberPhoto(alice.id, { bytes: PNG, type: "image/png" });
  assert.ok(second.ok);
  assert.ok(!existsSync(file(first.url)), "the replaced file is gone");

  const photos = await rows<{ email: string; group_id: string; photo_url: string | null }>(
    "select email, group_id, photo_url from memberships where email in ('alice@friendloop.test', 'bob@friendloop.test') order by email, group_id",
  );
  assert.equal(photos.filter((row) => row.photo_url).length, 1, "only the one membership has a photo");
  assert.ok(photos.every((row) => row.photo_url === null || row.group_id === loop.groupId));
  assert.ok(elsewhere.members.some((member) => member.email === "alice@friendloop.test"));
  assert.equal((await rows<{ photo_url: string | null }>("select photo_url from memberships where id = $1", [bob.id]))[0].photo_url, null);

  await clearMemberPhoto(alice.id);
  assert.equal((await rows<{ photo_url: string | null }>("select photo_url from memberships where id = $1", [alice.id]))[0].photo_url, null);
  assert.ok(!existsSync(file(second.url)));
  await clearMemberPhoto(alice.id);
});

test("a profile photo is refused when it is not an image, is over 2 MB, or has no membership", async (t) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  const text = await setMemberPhoto(alice.id, { bytes: new TextEncoder().encode("nope"), type: "image/png" });
  assert.deepEqual(text, { ok: false, status: 415, error: "Use a JPEG, PNG, WebP or GIF picture." });
  const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
  big.set(PNG);
  const tooBig = await setMemberPhoto(alice.id, { bytes: big, type: "image/png" });
  assert.deepEqual(tooBig, { ok: false, status: 413, error: "That photo is over 2 MB. Try a smaller one." });
  const missing = await setMemberPhoto("00000000-0000-4000-8000-000000000000", { bytes: PNG, type: "image/png" });
  assert.equal(missing.ok === false && missing.status, 404);

  const original = { NODE_ENV: process.env.NODE_ENV, E2E: process.env.E2E, TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
  const originalError = console.error;
  t.after(() => {
    setEnv("NODE_ENV", original.NODE_ENV);
    setEnv("E2E", original.E2E);
    setEnv("BLOB_READ_WRITE_TOKEN", original.TOKEN);
    console.error = originalError;
  });
  console.error = () => undefined;
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  const failed = await setMemberPhoto(alice.id, { bytes: PNG, type: "image/png" });
  assert.deepEqual(failed, { ok: false, status: 500, error: "That photo didn't save. Try again in a moment." });
});

test("an image that cannot be removed from storage is logged, not fatal", async (t) => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  // A URL in neither of the storage layer's namespaces is simply left alone.
  await rows("update memberships set photo_url = 'https://elsewhere.test/a.png' where id = $1", [alice.id]);
  await clearMemberPhoto(alice.id);

  // A managed Blob URL with no token configured makes deletion throw; the swap still succeeds.
  await rows(
    "update memberships set photo_url = $2 where id = $1",
    [alice.id, `https://store1.public.blob.vercel-storage.com/reply-photos/${"a".repeat(64)}.png`],
  );
  const original = { TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
  const originalError = console.error;
  const logged: unknown[] = [];
  t.after(() => {
    setEnv("BLOB_READ_WRITE_TOKEN", original.TOKEN);
    console.error = originalError;
  });
  console.error = (...args: unknown[]) => void logged.push(args);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  await clearMemberPhoto(alice.id);
  assert.equal(logged.length, 1);
  assert.equal((await rows<{ photo_url: string | null }>("select photo_url from memberships where id = $1", [alice.id]))[0].photo_url, null);
});

/* ------------------------------ handover ------------------------------ */

async function accessOf(groupId: string) {
  const people = await rows<{ email: string; access: string; participation: string }>(
    "select email, access, participation from memberships where group_id = $1 order by email",
    [groupId],
  );
  return Object.fromEntries(people.map((person) => [person.email.split("@")[0], `${person.access}/${person.participation}`]));
}

test("the owner hands the loop to an admin; the founder becomes an admin and the heir an owner who writes", async () => {
  const loop = await seedLoop();
  const owner = loop.members.find((member) => member.access === "owner")!;
  const heir = await addMember(loop, { email: "heir@friendloop.test", access: "admin", participation: "reader" });

  assert.equal(await transferOwnership(loop.groupId, owner.id, heir.id), true);
  assert.deepEqual(await accessOf(loop.groupId), {
    alice: "member/contributor",
    bob: "member/contributor",
    heir: "owner/contributor",
    owner: "admin/contributor",
  });

  // The founder cannot take it back: they are no longer the owner.
  assert.equal(await transferOwnership(loop.groupId, owner.id, heir.id), false);
  assert.equal(await transferOwnership(loop.groupId, owner.id, owner.id), false);
  assert.equal((await accessOf(loop.groupId)).heir, "owner/contributor");
  // The new owner can hand it back.
  assert.equal(await transferOwnership(loop.groupId, heir.id, owner.id), true);
  assert.equal((await accessOf(loop.groupId)).owner, "owner/contributor");
});

test("only an admin who has opened their invitation can inherit, and a refusal leaves everything as it was", async () => {
  const loop = await seedLoop();
  const owner = loop.members.find((member) => member.access === "owner")!;
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const pending = await addMember(loop, { email: "pending@friendloop.test", access: "admin", accepted: false });
  const gone = await addMember(loop, { email: "gone@friendloop.test", access: "admin" });
  await rows("update memberships set revoked_at = now() where id = $1", [gone.id]);
  const stranger = await seedLoop({ name: "Another loop" });
  const outsider = stranger.members.find((member) => member.access === "admin") ?? stranger.members[0];

  const before = await accessOf(loop.groupId);
  for (const target of [alice.id, pending.id, gone.id, outsider.id, "00000000-0000-4000-8000-000000000000"]) {
    assert.equal(await transferOwnership(loop.groupId, owner.id, target), false, target);
  }
  assert.deepEqual(await accessOf(loop.groupId), before, "the demotion rolled back with the refused promotion");

  assert.equal(await transferOwnership("00000000-0000-4000-8000-000000000000", owner.id, pending.id), false);
  // A non-owner cannot start one.
  const heir = await addMember(loop, { email: "heir@friendloop.test", access: "admin" });
  assert.equal(await transferOwnership(loop.groupId, alice.id, heir.id), false);
  assert.equal((await accessOf(loop.groupId)).owner, "owner/contributor");
});

test("two simultaneous handovers leave exactly one owner", async () => {
  const loop = await seedLoop();
  const owner = loop.members.find((member) => member.access === "owner")!;
  const a = await addMember(loop, { email: "a@friendloop.test", access: "admin" });
  const b = await addMember(loop, { email: "b@friendloop.test", access: "admin" });

  const results = await Promise.all([
    transferOwnership(loop.groupId, owner.id, a.id),
    transferOwnership(loop.groupId, owner.id, b.id),
  ]);
  assert.deepEqual(results.toSorted(), [false, true]);

  const owners = await rows<{ email: string }>("select email from memberships where group_id = $1 and access = 'owner'", [loop.groupId]);
  assert.equal(owners.length, 1);
  assert.notEqual(owners[0].email, "owner@friendloop.test");
});

test("in a from_you loop the founder stops writing when the loop moves on", async () => {
  const loop = await seedLoop({ mode: "from_you" });
  const owner = loop.members.find((member) => member.access === "owner")!;
  const heir = await addMember(loop, { email: "heir@friendloop.test", access: "admin", participation: "reader" });

  assert.equal(await transferOwnership(loop.groupId, owner.id, heir.id), true);
  const access = await accessOf(loop.groupId);
  assert.equal(access.heir, "owner/contributor");
  assert.equal(access.owner, "admin/reader");
});

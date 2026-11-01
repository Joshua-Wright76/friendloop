import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  authorizeQuestionForReply,
  deletePhotoIfUnreferenced,
  INVITE_DAYS,
  photoSavedFor,
  removePhotoFor,
  resolveToken,
  saveDraftFor,
  saveNameFor,
  savePhotoFor,
  sheetFor,
  submitFor,
} from "../../src/lib/reply.ts";
import { storePhoto } from "../../src/lib/photo-storage.ts";
import { resetDatabase, rows, seedLoop, seedOpenIssue, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { calls as blobCalls, reset as resetBlob } from "../stubs/vercel-blob.mjs";

beforeEach(async () => {
  await resetDatabase();
  resetBlob();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const JPEG_FORMAT = { contentType: "image/jpeg", extension: "jpg" } as const;

async function openLoop() {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const [question] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 order by position limit 1",
    [issue.issueId],
  );
  const [second] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 order by position offset 1 limit 1",
    [issue.issueId],
  );
  return { loop, issue, alice, bob, question, second };
}


setupDatabase();

test("a token resolves to the open round, a reader, an expired invite, or nothing", async () => {
  const { alice } = await openLoop();

  const ok = await resolveToken(alice.token);
  assert.equal(ok.state, "ok");

  assert.deepEqual(await resolveToken("never-issued"), { state: "invalid" });

  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  assert.equal((await resolveToken(alice.token)).state, "reader");

  const stale = new Date(E2E_NOW.getTime() - (INVITE_DAYS + 1) * 24 * 60 * 60 * 1000);
  await rows(
    "update memberships set participation = 'contributor', accepted_at = null, invited_at = $1 where id = $2",
    [stale.toISOString(), alice.id],
  );
  const expired = await resolveToken(alice.token);
  assert.equal(expired.state, "expired");
  assert.ok(expired.state === "expired" && expired.groupName.length > 0);

  await rows("update memberships set revoked_at = $1 where id = $2", [E2E_NOW.toISOString(), alice.id]);
  assert.deepEqual(await resolveToken(alice.token), { state: "invalid" });
});

test("a contributor with no round open still resolves, with no issue", async () => {
  const loop = await seedLoop();
  const context = await resolveToken(loop.members[1].token);
  assert.equal(context.state, "ok");
  assert.equal(context.state === "ok" && context.issue, null);

  // Writing is refused, but readably.
  const result = await saveDraftFor({
    token: loop.members[1].token,
    issueQuestionId: "00000000-0000-4000-8000-000000000000",
    body: "x",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  assert.equal(await sheetFor(loop.members[1].token), null);
});

test("drafts save, update in place, and are capped", async () => {
  const { alice, question } = await openLoop();

  const first = await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "  hello  " });
  assert.equal(first.ok, true);

  const second = await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "replaced" });
  assert.equal(second.ok, true);

  const saved = await rows<{ body: string; status: string; updated_at: Date }>("select body, status, updated_at from replies");
  assert.equal(saved.length, 1, "one row per answer");
  assert.equal(saved[0].body, "replaced");
  assert.equal(saved[0].status, "draft");

  const long = "x".repeat(9000);
  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: long });
  const [capped] = await rows<{ body: string }>("select body from replies");
  assert.equal(capped.body.length, 8000);
});

test("a draft for a question in another round is refused", async () => {
  const { alice } = await openLoop();
  const other = await seedLoop({ name: "Other" });
  const otherIssue = await seedOpenIssue(other, { openedAt: AFTER_FIRST_SLOT });
  const [otherQuestion] = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 limit 1",
    [otherIssue.issueId],
  );

  const result = await saveDraftFor({
    token: alice.token,
    issueQuestionId: otherQuestion.id,
    body: "not my round",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);

  const writes = await rows<{ count: number }>("select count(*)::int as count from replies");
  assert.equal(writes[0].count, 0);
});

test("submitting marks answers with content and leaves empty ones alone", async () => {
  const { alice, question, second } = await openLoop();
  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "A real answer" });
  await saveDraftFor({ token: alice.token, issueQuestionId: second.id, body: "" });

  const result = await submitFor(alice.token);
  assert.equal(result.ok, true);

  const replies = await rows<{ body: string; status: string; submitted_at: Date | null }>(
    "select body, status, submitted_at from replies order by body",
  );
  assert.equal(replies.length, 2);
  assert.equal(replies[1].status, "submitted");
  assert.ok(replies[1].submitted_at);
  assert.equal(replies[0].status, "draft", "an empty answer is not a submission");
});

test("a photo-only answer counts as content", async () => {
  const { alice, question } = await openLoop();
  const photoUrl = "http://localhost:3100/uploads/" + "a".repeat(64) + ".jpg";

  const saved = await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });
  assert.equal(saved.ok, true);

  await submitFor(alice.token);
  const [reply] = await rows<{ status: string }>("select status from replies");
  assert.equal(reply.status, "submitted");
});

test("saving a photo replaces the old one and deletes the file nobody points at", async () => {
  const { alice, question } = await openLoop();
  const first = await storePhoto(JPEG, JPEG_FORMAT);
  const second = await storePhoto(JPEG, JPEG_FORMAT);

  await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl: first });
  const replaced = await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl: second });
  assert.equal(replaced.ok, true);

  const [reply] = await rows<{ photo_url: string }>("select photo_url from replies");
  assert.equal(reply.photo_url, second);

  const filename = (url: string) => path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!);
  assert.equal(existsSync(filename(first)), false, "the replaced file is gone");
  assert.equal(existsSync(filename(second)), true);
});

test("a photo URL already used by somebody else is refused", async () => {
  const { alice, bob, question } = await openLoop();
  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);

  assert.equal((await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl })).ok, true);
  const stolen = await savePhotoFor({ token: bob.token, issueQuestionId: question.id, photoUrl });
  assert.equal(stolen.ok, false);
  if (!stolen.ok) assert.equal(stolen.status, 409);

  const owners = await rows<{ count: number }>("select count(*)::int as count from replies where photo_url = $1", [
    photoUrl,
  ]);
  assert.equal(owners[0].count, 1);
});

test("a photo saved after delivery is marked as a later addition", async () => {
  const { alice, question, issue } = await openLoop();
  await rows("update issues set status = 'delivered', delivered_at = $1 where id = $2", [
    DELIVERY_DAY.toISOString(),
    issue.issueId,
  ]);

  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);
  const saved = await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });
  assert.equal(saved.ok, true);

  const [reply] = await rows<{ added_after_delivery: boolean }>("select added_after_delivery from replies");
  assert.equal(reply.added_after_delivery, true);
});

test("removing a photo keeps the text and deletes the file", async () => {
  const { alice, question } = await openLoop();
  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);
  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "With a picture" });
  await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });

  const result = await removePhotoFor({ token: alice.token, issueQuestionId: question.id });
  assert.equal(result.ok, true);

  const [reply] = await rows<{ photo_url: string | null; body: string; status: string }>(
    "select photo_url, body, status from replies",
  );
  assert.equal(reply.photo_url, null);
  assert.equal(reply.body, "With a picture");

  const filename = path.join(process.cwd(), "public", "uploads", photoUrl.split("/").at(-1)!);
  assert.equal(existsSync(filename), false);

  // Removing again is a no-op, not an error.
  assert.equal((await removePhotoFor({ token: alice.token, issueQuestionId: question.id })).ok, true);
});

test("a photo URL that is not ours is never deleted", async () => {
  const photoUrl = "http://localhost:3100/not-an-upload.jpg";
  await deletePhotoIfUnreferenced(photoUrl);
  await deletePhotoIfUnreferenced("https://example.com/somebody-elses.jpg");
  assert.deepEqual(blobCalls.del, [], "nothing was asked of the blob store");
});

test("a referenced photo survives, an unreferenced local one is removed", async () => {
  const { alice, question } = await openLoop();
  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);
  await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });

  await deletePhotoIfUnreferenced(photoUrl);
  const filename = path.join(process.cwd(), "public", "uploads", photoUrl.split("/").at(-1)!);
  assert.equal(existsSync(filename), true, "the reply still points at it");

  await rows("delete from replies");
  await deletePhotoIfUnreferenced(photoUrl);
  assert.equal(existsSync(filename), false);
});

test("a name typed on the sheet is applied across loops, without overwriting", async () => {
  const { loop, alice } = await openLoop();
  const second = await seedLoop({ name: "Second" });

  // The same person, in a second loop, not yet named there.
  await rows(
    `update memberships set name = null where group_id = $1 and email = 'alice@friendloop.test'`,
    [second.groupId],
  );

  const result = await saveNameFor({ token: alice.token, name: "  Alice  A. " });
  assert.equal(result.ok, true);

  const named = await rows<{ group_id: string; name: string | null }>(
    "select group_id, name from memberships where email = 'alice@friendloop.test' order by group_id",
  );
  assert.equal(named.length, 2);
  assert.ok(named.every((row) => row.name === "Alice A."));

  // The loop that already had a name keeps it.
  await rows(
    "update memberships set name = 'Chosen Elsewhere' where email = 'alice@friendloop.test' and group_id = $1",
    [second.groupId],
  );
  await saveNameFor({ token: alice.token, name: "Alice Again" });
  const [other] = await rows<{ name: string }>(
    "select name from memberships where email = 'alice@friendloop.test' and group_id = $1",
    [second.groupId],
  );
  assert.equal(other.name, "Chosen Elsewhere");

  // And the owning account, if there is one, follows.
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ('alice@friendloop.test', 'old') returning id",
  );
  await rows("update memberships set user_id = $1 where id = $2", [user.id, alice.id]);
  await saveNameFor({ token: alice.token, name: "Alice Renamed" });
  const [account] = await rows<{ name: string }>("select name from users where id = $1", [user.id]);
  assert.equal(account.name, "Alice Renamed");

  // A blank name clears the byline rather than storing an empty string.
  await saveNameFor({ token: alice.token, name: "   " });
  const [cleared] = await rows<{ name: string | null }>("select name from memberships where id = $1", [alice.id]);
  assert.equal(cleared.name, null);
  assert.ok(loop.groupId);
});

test("an unaccepted invite becomes accepted when the person writes", async () => {
  const { alice, question } = await openLoop();
  await rows("update memberships set accepted_at = null where id = $1", [alice.id]);

  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "Here I am" });

  const [membership] = await rows<{ accepted_at: Date | null }>(
    "select accepted_at from memberships where id = $1",
    [alice.id],
  );
  assert.equal(new Date(membership.accepted_at!).toISOString(), AFTER_FIRST_SLOT.toISOString());
});

test("the write gates refuse readers, expired invites, and unknown links", async () => {
  const { loop, alice, question } = await openLoop();

  assert.deepEqual(
    await authorizeQuestionForReply("never-issued", question.id),
    await authorizeQuestionForReply("never-issued", question.id),
  );
  const unknown = await authorizeQuestionForReply("never-issued", question.id);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.status, 404, "an unknown link is simply not found");

  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  const reader = await authorizeQuestionForReply(alice.token, question.id);
  assert.equal(reader.ok, false);
  if (!reader.ok) assert.equal(reader.status, 403);

  const stale = new Date(E2E_NOW.getTime() - (INVITE_DAYS + 1) * 24 * 60 * 60 * 1000);
  await rows(
    "update memberships set participation = 'contributor', accepted_at = null, invited_at = $1 where id = $2",
    [stale.toISOString(), alice.id],
  );
  const expired = await authorizeQuestionForReply(alice.token, question.id);
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.status, 403);

  await rows("update memberships set accepted_at = $1 where id = $2", [E2E_NOW.toISOString(), alice.id]);
  const wrongQuestion = await authorizeQuestionForReply(alice.token, "00000000-0000-4000-8000-000000000000");
  assert.equal(wrongQuestion.ok, false);
  if (!wrongQuestion.ok) assert.equal(wrongQuestion.status, 409);

  assert.deepEqual(await authorizeQuestionForReply(alice.token, question.id), { ok: true });
  assert.ok(loop.groupId);
});

test("the blob completion check reports saved, pending, and refused", async () => {
  const { alice, bob, question } = await openLoop();
  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);

  assert.deepEqual(
    await photoSavedFor({ token: alice.token, issueQuestionId: question.id, photoUrl }),
    { ok: true, saved: false },
  );

  await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });
  assert.deepEqual(
    await photoSavedFor({ token: alice.token, issueQuestionId: question.id, photoUrl }),
    { ok: true, saved: true },
  );

  // Somebody else's round or somebody else's photo: not saved.
  assert.deepEqual(
    await photoSavedFor({ token: bob.token, issueQuestionId: question.id, photoUrl }),
    { ok: true, saved: false },
  );

  const refused = await photoSavedFor({ token: "never-issued", issueQuestionId: question.id, photoUrl });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.status, 404);
});

test("the sheet carries the person's own answers and submitted state", async () => {
  const { alice, question } = await openLoop();
  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "Mine" });
  await submitFor(alice.token);

  const sheet = await sheetFor(alice.token);
  assert.ok(sheet);
  assert.equal(sheet.questions.length, 2);
  assert.equal(sheet.questions[0].body, "Mine");
  assert.equal(sheet.questions[0].submitted, true);
  assert.equal(sheet.questions[1].body, "");
  assert.equal(sheet.questions[1].submitted, false);

  assert.equal(await sheetFor("never-issued"), null);
});

test("a reply write after the deadline is marked as coming later", async () => {
  const { alice, question } = await openLoop();
  setRequestHeaders({ "x-e2e-now": new Date(DELIVERY_DAY.getTime() + 60_000).toISOString() });

  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "Late" });

  const [reply] = await rows<{ added_after_delivery: boolean }>("select added_after_delivery from replies");
  assert.equal(reply.added_after_delivery, true);
});

test("a photo write needs an open round, not just a valid token", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const result = await authorizeQuestionForReply(alice.token, "00000000-0000-4000-8000-000000000000");

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 409);
  const saved = await savePhotoFor({
    token: alice.token,
    issueQuestionId: "00000000-0000-4000-8000-000000000000",
    photoUrl: "http://localhost:3100/uploads/" + "b".repeat(64) + ".jpg",
  });
  assert.equal(saved.ok, false);
  if (!saved.ok) assert.equal(saved.status, 409);
});

test("a photo from an unaccepted invite accepts it", async () => {
  const { alice, question } = await openLoop();
  await rows("update memberships set accepted_at = null where id = $1", [alice.id]);

  const photoUrl = await storePhoto(JPEG, JPEG_FORMAT);
  const saved = await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl });
  assert.equal(saved.ok, true);

  const [membership] = await rows<{ accepted_at: Date | null }>(
    "select accepted_at from memberships where id = $1",
    [alice.id],
  );
  assert.equal(new Date(membership.accepted_at!).toISOString(), AFTER_FIRST_SLOT.toISOString());
});

test("a photo that cannot be cleaned up does not fail the save", async (t) => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  const originalError = console.error;
  const logged: string[] = [];
  t.after(() => {
    console.error = originalError;
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });
  console.error = (message: string) => logged.push(message);
  delete process.env.BLOB_READ_WRITE_TOKEN;

  const { alice, question, bob } = await openLoop();
  const orphan =
    "https://store123.public.blob.vercel-storage.com/reply-photos/" + "c".repeat(64) + ".jpg";
  const replacement = await storePhoto(JPEG, JPEG_FORMAT);

  // Alice's reply already points at a blob we can no longer delete (no token).
  await saveDraftFor({ token: alice.token, issueQuestionId: question.id, body: "text" });
  await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl: orphan });

  const saved = await savePhotoFor({ token: alice.token, issueQuestionId: question.id, photoUrl: replacement });
  assert.equal(saved.ok, true, "the new photo is saved even when the old one cannot be removed");
  assert.match(logged.join("\n"), /Unable to remove replaced reply photo/);

  // Same for removal: point the reply back at the undeletable blob first.
  await rows("update replies set photo_url = $1", [orphan]);
  const removed = await removePhotoFor({ token: alice.token, issueQuestionId: question.id });
  assert.equal(removed.ok, true);
  assert.match(logged.join("\n"), /Unable to remove reply photo/);
  assert.ok(bob.id);
});

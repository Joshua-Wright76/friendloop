import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  REDACTED_EMAIL,
  accountDeletionPlan,
  eraseAccount,
  eraseLoop,
  leaveContext,
  leaveLoop,
} from "../../src/lib/erasure.ts";
import {
  MAX_MEDIA_ATTEMPTS,
  isMediaReferenced,
  purgeMedia,
  purgeQueuedMedia,
  queueMediaDeletion,
  removeStoredFile,
} from "../../src/lib/media-cleanup.ts";
import { deleteLoop } from "../../src/lib/manage.ts";
import { limitKey } from "../../src/lib/rate-limit-policy.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { db } from "@/db";
import { addMember, rows, seedDeliveredIssue, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { calls as blobCalls, failures as blobFailures, reset as resetBlob } from "../stubs/vercel-blob.mjs";

const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
  resetBlob();
  setEnv("BLOB_READ_WRITE_TOKEN", "test-blob-token");
});

afterEach(() => setEnv("BLOB_READ_WRITE_TOKEN", originalToken));

setupDatabase();

/** A Blob URL in the shape the storage layers own, unique per seed. */
function blob(kind: "photo" | "audio", seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  return kind === "photo"
    ? `https://store123.public.blob.vercel-storage.com/reply-photos/${hash}.png`
    : `https://store123.public.blob.vercel-storage.com/reply-audio/${hash}.webm`;
}

function deleted(): string[] {
  return blobCalls.del.map((call: { url: string }) => call.url);
}

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const [row] = await rows<T>(sql, params);
  return row;
}

const WREN = { email: "wren@erase.test", name: "Wren Quillfeather" };

/**
 * One person with a footprint in every table that can point at a person: a
 * loop they are a member of (answers, photos, voice notes, comments, reactions,
 * a suggestion the owner accepted, a birthday, a section photo, feedback,
 * email), a loop they own alone, and a loop that invited their address before
 * they ever signed in. Everyone else's things sit next to theirs.
 */
async function seedWorld() {
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ($1, $2) returning id",
    [WREN.email, WREN.name],
  );
  await rows("insert into sessions (user_id, token_hash, expires_at) values ($1, 'wren-session', now() + interval '1 day')", [user.id]);
  await rows("insert into magic_links (email, token_hash, expires_at) values ($1, 'wren-link', now())", [WREN.email]);

  // Loop A: Sam's, with Wren and Alice in it.
  const loop = await seedLoop({ members: [{ email: "alice@friendloop.test", name: "Alice" }] });
  const wren = await addMember(loop, { email: WREN.email, name: WREN.name });
  loop.members.push({ ...wren, participation: "contributor", access: "member" });
  await rows("update memberships set user_id = $1, photo_url = $2 where id = $3", [user.id, blob("photo", "wren-avatar"), wren.id]);
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;
  await rows("update groups set header_image_url = $1 where id = $2", [blob("photo", "loop-a-header"), loop.groupId]);

  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [
      { email: WREN.email, body: "Wren's answer" },
      { email: "alice@friendloop.test", body: "Alice's answer" },
    ],
  });
  const wrenReply = await one<{ id: string }>("select id from replies where membership_id = $1", [wren.id]);
  const aliceReply = await one<{ id: string }>("select id from replies where membership_id = $1", [alice.id]);
  await rows("update replies set photo_url = $1, audio_url = $2 where id = $3", [blob("photo", "wren-reply"), blob("audio", "wren-voice"), wrenReply.id]);
  await rows("update replies set photo_url = $1 where id = $2", [blob("photo", "alice-reply"), aliceReply.id]);

  // Comments: Wren's own, Alice's hanging from Wren's answer, Alice's mentioning Wren elsewhere.
  await rows("insert into comments (issue_id, membership_id, body, photo_url) values ($1, $2, 'From Wren', $3)", [issue.issueId, wren.id, blob("photo", "wren-comment")]);
  await rows("insert into comments (issue_id, membership_id, body, reply_id, photo_url) values ($1, $2, 'Love this', $3, $4)", [issue.issueId, alice.id, wrenReply.id, blob("photo", "alice-on-wren")]);
  await rows("insert into comments (issue_id, membership_id, body, reply_id) values ($1, $2, $3, $4)", [issue.issueId, alice.id, `Agree with @[${wren.id}]`, aliceReply.id]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '💛'), ($3, $4, '🎉')", [aliceReply.id, wren.id, wrenReply.id, alice.id]);

  // A suggestion the owner accepted, credited by name on the round.
  const [question] = await rows<{ id: string }>("insert into questions (group_id, text, position, created_by_membership_id) values ($1, 'Best snack?', 9, $2) returning id", [loop.groupId, wren.id]);
  await rows("insert into question_suggestions (group_id, membership_id, text, status, accepted_question_id) values ($1, $2, 'Best snack?', 'accepted', $3)", [loop.groupId, wren.id, question.id]);
  await rows("insert into issue_questions (issue_id, question_id, text, position, suggested_by) values ($1, $2, 'Best snack?', 9, $3)", [issue.issueId, question.id, WREN.name]);

  // A birthday, snapshotted into the round with Alice's wishes and photo on it.
  const [birthday] = await rows<{ id: string }>("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 3, 4, $2) returning id", [loop.groupId, wren.id]);
  const [birthdaySection] = await rows<{ id: string }>(
    "insert into issue_sections (issue_id, kind, title, event_id, event_date) values ($1, 'standard', $2, $3, '2026-03-04') returning id",
    [issue.issueId, `${WREN.name}'s birthday`, birthday.id],
  );
  const [wishes] = await rows<{ id: string }>("insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'Happy birthday', 'submitted') returning id", [issue.issueId, birthdaySection.id, alice.id]);
  await rows("insert into section_media (section_reply_id, url) values ($1, $2)", [wishes.id, blob("photo", "alice-birthday")]);

  // A regular section with Wren's photo wall entry.
  const [section] = await rows<{ id: string }>("insert into sections (group_id, kind, title) values ($1, 'photo_wall', 'Wall') returning id", [loop.groupId]);
  const [wall] = await rows<{ id: string }>("insert into issue_sections (issue_id, section_id, kind, title) values ($1, $2, 'photo_wall', 'Wall') returning id", [issue.issueId, section.id]);
  const [wallReply] = await rows<{ id: string }>("insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'My week', 'submitted') returning id", [issue.issueId, wall.id, wren.id]);
  await rows("insert into section_media (section_reply_id, url, caption) values ($1, $2, 'Hike')", [wallReply.id, blob("photo", "wren-wall")]);

  // Feedback and the email trail.
  await rows("insert into feedback (message, path, user_id, membership_id, sender_name, sender_email) values ('Hi', '/you', $1, $2, $3, $4)", [user.id, wren.id, WREN.name, WREN.email]);
  await rows(
    `insert into outbox (\"to\", subject, html, text, kind, dedupe_key, group_id, issue_id, membership_id, status, provider_id) values
      ($1, 'Sign in', 'link', 'link', 'signin', 'signin:wren', null, null, null, 'sent', 'p-signin'),
      ($1, 'Your round', 'answers', 'answers', 'delivery', 'delivery:wren', $2, $3, $4, 'sent', 'p-wren'),
      ('alice@friendloop.test', 'Your round', $5, $5, 'delivery', 'delivery:alice', $2, $3, $6, 'sent', 'p-alice'),
      ('alice@friendloop.test', 'Pending', $5, $5, 'delivery', 'delivery:alice:2', $2, $3, $6, 'pending', null)`,
    [WREN.email, loop.groupId, issue.issueId, wren.id, `${WREN.name}: Wren's answer`, alice.id],
  );
  await rows(
    "insert into email_events (provider_id, type, payload) values ('p-signin', 'delivered', $1), ('p-wren', 'delivered', $1), ('p-alice', 'delivered', '{}')",
    [JSON.stringify({ to: WREN.email })],
  );

  // Loop B: Wren's own, nobody else in it.
  const solo = await seedLoop({ name: "Wren's notebook", owner: { email: WREN.email, name: WREN.name }, members: [] });
  await rows("update memberships set user_id = $1 where group_id = $2", [user.id, solo.groupId]);
  await rows("update groups set header_image_url = $1 where id = $2", [blob("photo", "solo-header"), solo.groupId]);

  // Loop C: invited by address, never signed in, answered through the link.
  const invited = await seedLoop({ name: "Book club", members: [{ email: WREN.email, name: "W_100%" }] });
  const pending = invited.members.find((member) => member.email === WREN.email)!;
  await seedDeliveredIssue(invited, { deliveredAt: E2E_NOW, answers: [{ email: WREN.email, body: "Loved it" }] });
  await rows("update replies set audio_url = $1 where membership_id = $2", [blob("audio", "wren-book"), pending.id]);

  // Abuse counters: Wren's are keyed by address, account and membership; Alice's and a network's stay.
  await rows(
    `insert into rate_limits (key, window_start, count, expires_at) values
      ($1, now(), 1, now() + interval '1 hour'), ($2, now(), 1, now() + interval '1 hour'),
      ($3, now(), 1, now() + interval '1 hour'), ($4, now(), 1, now() + interval '1 hour'),
      ($5, now(), 1, now() + interval '1 hour'), ($6, now(), 1, now() + interval '1 hour'),
      ('signin:ip:203.0.113.9', now(), 1, now() + interval '1 hour')`,
    [
      limitKey.signInEmail(WREN.email),
      limitKey.feedbackUser(user.id),
      limitKey.comment(wren.id),
      limitKey.feedbackMember(wren.id),
      limitKey.comment(pending.id),
      limitKey.comment(alice.id),
    ],
  );

  return { userId: user.id, loop, wren, alice, solo, invited, pending, issue };
}

type ForeignKey = { table: string; column: string; references: string };

/** Every foreign key in the database, read from the catalog rather than a list. */
async function foreignKeys(): Promise<ForeignKey[]> {
  return rows<ForeignKey>(
    `select cl.relname as table, att.attname as column, ref.relname as references
       from pg_constraint con
       join pg_class cl on cl.oid = con.conrelid
       join pg_class ref on ref.oid = con.confrelid
       join pg_namespace ns on ns.oid = cl.relnamespace
       join lateral unnest(con.conkey) as k(attnum) on true
       join pg_attribute att on att.attrelid = cl.oid and att.attnum = k.attnum
      where con.contype = 'f' and ns.nspname = 'public'`,
  );
}

/** Every column that can hold text, so a name or address frozen anywhere is found. */
async function textColumns(): Promise<Array<{ table: string; column: string }>> {
  return rows(
    `select table_name as table, column_name as column from information_schema.columns
      where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json')`,
  );
}

async function rowsMentioning(needle: string): Promise<string[]> {
  const found: string[] = [];
  for (const { table, column } of await textColumns()) {
    const [{ count }] = await rows<{ count: number }>(
      `select count(*)::int as count from "${table}" where "${column}"::text ilike $1`,
      [`%${needle}%`],
    );
    if (count > 0) found.push(`${table}.${column} (${count})`);
  }
  return found;
}

test("deleting an account leaves no row pointing at the person, in any table the schema has", async () => {
  const world = await seedWorld();
  const people = { users: [world.userId], memberships: [world.wren.id, world.pending.id] };

  // Walk the catalog: every foreign key that points at a person. The seed must
  // reach each one, or a new table could hold someone's data unseen.
  const personal = (await foreignKeys()).filter((key) => key.references === "users" || key.references === "memberships");
  assert.ok(personal.length >= 10, "the walk found the schema's person references");
  const unseeded: string[] = [];
  for (const key of personal) {
    const ids = people[key.references as "users" | "memberships"];
    const [{ count }] = await rows<{ count: number }>(
      `select count(*)::int as count from "${key.table}" where "${key.column}" = any($1::uuid[])`,
      [ids],
    );
    if (count === 0) unseeded.push(`${key.table}.${key.column}`);
  }
  assert.deepEqual(
    unseeded,
    [],
    "a table points at a person but this test seeds nothing there: add a row to seedWorld and make sure erasure.ts removes it",
  );

  const result = await eraseAccount(world.userId);
  assert.deepEqual(result, { ok: true, loopsDeleted: 1, files: 9 });

  for (const key of personal) {
    const ids = people[key.references as "users" | "memberships"];
    const [{ count }] = await rows<{ count: number }>(
      `select count(*)::int as count from "${key.table}" where "${key.column}" = any($1::uuid[])`,
      [ids],
    );
    assert.equal(count, 0, `${key.table}.${key.column} still points at the deleted person`);
  }

  // Nothing anywhere still carries their address or their name.
  assert.deepEqual(await rowsMentioning(WREN.email), []);
  assert.deepEqual(await rowsMentioning("Quillfeather"), []);

  // Their abuse counters went with them (the address one is caught above too);
  // Alice's and the network's stayed.
  const counters = await rows<{ key: string }>("select key from rate_limits order by key");
  assert.deepEqual(counters.map((row) => row.key).sort(), [limitKey.comment(world.alice.id), "signin:ip:203.0.113.9"].sort());

  // Their loop went; everyone else's stayed, with everyone else's words.
  assert.equal((await rows("select id from groups where id = $1", [world.solo.groupId])).length, 0);
  assert.equal((await rows("select id from groups where id = $1", [world.loop.groupId])).length, 1);
  assert.equal((await rows("select id from replies where membership_id = $1", [world.alice.id])).length, 1);
  const [mention] = await rows<{ body: string }>("select body from comments where membership_id = $1", [world.alice.id]);
  assert.match(mention.body, /^Agree with/);
  assert.equal((await rows("select id from questions where text = 'Best snack?'")).length, 1, "an accepted question stays the loop's");
  const [sentMail] = await rows<{ html: string }>("select html from outbox where dedupe_key = 'delivery:alice'");
  assert.equal(sentMail.html, REDACTED_EMAIL, "the stored copy of Alice's round no longer shows Wren");
  assert.equal((await rows("select id from outbox where dedupe_key = 'delivery:alice:2'")).length, 0, "an unsent copy is dropped, never sent blank");
  assert.equal((await rows("select id from email_events where provider_id = 'p-alice'")).length, 1);

  // Every file of theirs, and the ones hanging from their words, went from storage.
  assert.deepEqual(new Set(deleted()), new Set([
    blob("photo", "wren-avatar"),
    blob("photo", "wren-reply"),
    blob("audio", "wren-voice"),
    blob("photo", "wren-comment"),
    blob("photo", "alice-on-wren"),
    blob("photo", "alice-birthday"),
    blob("photo", "wren-wall"),
    blob("photo", "solo-header"),
    blob("audio", "wren-book"),
  ]));
  assert.equal((await rows("select id from media_deletions")).length, 0, "nothing left queued");
});

test("an owner with people in their loop is refused until it is handed on, and nothing changes", async () => {
  const world = await seedWorld();
  const [sam] = await rows<{ id: string }>("insert into users (email, name) values ('owner@friendloop.test', 'Sam') returning id");
  await rows("update memberships set user_id = $1 where email = 'owner@friendloop.test'", [sam.id]);
  const before = await rows("select count(*)::int as count from replies");

  const plan = await accountDeletionPlan(sam.id);
  assert.deepEqual(
    plan?.blocking.map((loop) => `${loop.groupId}:${loop.others}`).sort(),
    [`${world.loop.groupId}:2`, `${world.invited.groupId}:1`].sort(),
  );
  assert.deepEqual(plan?.solo, []);

  const refused = await eraseAccount(sam.id);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.reason, "owner");
  assert.equal(!refused.ok && refused.reason === "owner" && refused.loops.length, 2);
  assert.deepEqual(await rows("select count(*)::int as count from replies"), before);
  assert.equal((await rows("select id from users where id = $1", [sam.id])).length, 1);
  assert.deepEqual(deleted(), []);

  // Wren's own plan: their solo loop goes with them, nothing blocks.
  const wrenPlan = await accountDeletionPlan(world.userId);
  assert.deepEqual(wrenPlan?.blocking, []);
  assert.deepEqual(wrenPlan?.solo.map((loop) => loop.name), ["Wren's notebook"]);
});

test("a missing account is a plain not-found", async () => {
  assert.equal(await accountDeletionPlan("00000000-0000-4000-8000-000000000000"), null);
  assert.deepEqual(await eraseAccount("00000000-0000-4000-8000-000000000000"), { ok: false, reason: "not-found" });
});

test("a database failure is not mistaken for a refusal", async () => {
  await assert.rejects(eraseAccount("not-a-uuid"));
  await assert.rejects(leaveLoop("bad\u0000token"));
});

test("a reply link removes its person from that loop only, with everything they wrote there", async () => {
  const world = await seedWorld();

  assert.deepEqual(await leaveContext(world.alice.token), { groupId: world.loop.groupId, groupName: "Friday Loop", isOwner: false });
  assert.deepEqual(await leaveLoop(world.alice.token), { ok: true, groupName: "Friday Loop" });

  assert.equal((await rows("select id from memberships where id = $1", [world.alice.id])).length, 0);
  assert.equal((await rows("select id from replies where membership_id = $1", [world.alice.id])).length, 0);
  assert.equal((await rows("select id from comments where membership_id = $1", [world.alice.id])).length, 0);
  assert.equal((await rows("select id from outbox where dedupe_key like 'delivery:alice%'")).length, 0);
  assert.equal((await rows("select id from email_events where provider_id = 'p-alice'")).length, 0);
  assert.deepEqual(new Set(deleted()), new Set([
    blob("photo", "alice-reply"),
    blob("photo", "alice-on-wren"),
    blob("photo", "alice-birthday"),
  ]));
  assert.equal((await rows("select key from rate_limits where key = $1", [limitKey.comment(world.alice.id)])).length, 0);
  // Wren is untouched, in this loop and the others.
  assert.equal((await rows("select key from rate_limits where key = $1", [limitKey.comment(world.wren.id)])).length, 1);
  assert.equal((await rows("select id from replies where membership_id = $1", [world.wren.id])).length, 1);
  assert.equal((await rows("select id from users where id = $1", [world.userId])).length, 1);

  // The link is spent, and an owner cannot leave through theirs.
  assert.deepEqual(await leaveLoop(world.alice.token), { ok: false, reason: "not-found" });
  assert.equal(await leaveContext(world.alice.token), null);
  assert.deepEqual(await leaveLoop(world.loop.ownerToken), { ok: false, reason: "owner" });
  assert.equal((await leaveContext(world.loop.ownerToken))?.isOwner, true);
});

test("deleting a loop removes every file in it and the email trail, and nothing of other loops", async () => {
  const world = await seedWorld();

  await deleteLoop(world.loop.groupId);
  assert.equal((await rows("select id from groups where id = $1", [world.loop.groupId])).length, 0);
  assert.equal((await rows("select id from email_events where provider_id in ('p-wren', 'p-alice')")).length, 0);
  assert.equal((await rows("select id from email_events where provider_id = 'p-signin'")).length, 1);
  // Counters named after this loop's members went; the address and other loops' stayed.
  const counters = await rows<{ key: string }>("select key from rate_limits");
  assert.deepEqual(counters.map((row) => row.key).sort(), [
    limitKey.signInEmail(WREN.email),
    limitKey.feedbackUser(world.userId),
    limitKey.comment(world.pending.id),
    "signin:ip:203.0.113.9",
  ].sort());
  assert.deepEqual(new Set(deleted()), new Set([
    blob("photo", "loop-a-header"),
    blob("photo", "wren-avatar"),
    blob("photo", "wren-reply"),
    blob("audio", "wren-voice"),
    blob("photo", "alice-reply"),
    blob("photo", "wren-comment"),
    blob("photo", "alice-on-wren"),
    blob("photo", "alice-birthday"),
    blob("photo", "wren-wall"),
  ]));

  // A loop that never had anything is just as deletable.
  resetBlob();
  const empty = await seedLoop({ name: "Empty", owner: null, members: [] });
  assert.deepEqual(await eraseLoop(empty.groupId), { files: 0 });
  assert.deepEqual(deleted(), []);
});

test("a file storage refuses stays queued, and the sweep finishes the job", async () => {
  const world = await seedWorld();
  blobFailures.del = 3;

  await leaveLoop(world.alice.token);
  const queued = await rows<{ url: string; attempts: number; last_error: string }>("select url, attempts, last_error from media_deletions");
  assert.equal(queued.length, 1, "one file failed three times in a row and was kept");
  assert.equal(queued[0].attempts, 3);
  assert.equal(queued[0].last_error, "Blob is unavailable");

  const report = await sweep({ at: E2E_NOW });
  assert.equal(report.mediaPurged, 1);
  assert.equal((await rows("select id from media_deletions")).length, 0);
  assert.ok(deleted().includes(queued[0].url));
});

test("the queue never removes a file something still shows, and gives up on a hopeless one", async () => {
  const world = await seedWorld();
  const inUse = blob("photo", "alice-reply");
  const queued = await queueMediaDeletion(db, [inUse, inUse, null, "", undefined]);
  assert.deepEqual(queued, [inUse]);
  assert.deepEqual(await queueMediaDeletion(db, []), []);

  assert.equal(await isMediaReferenced(inUse), true);
  for (const url of [blob("photo", "wren-comment"), blob("photo", "alice-birthday"), blob("photo", "wren-avatar"), blob("photo", "loop-a-header")]) {
    assert.equal(await isMediaReferenced(url), true, url);
  }
  assert.equal(await purgeMedia([inUse]), 1);
  assert.deepEqual(deleted(), [], "a referenced file is left alone");
  assert.equal((await rows("select id from media_deletions")).length, 0);

  await rows("insert into media_deletions (url, attempts) values ($1, $2)", [blob("photo", "hopeless"), MAX_MEDIA_ATTEMPTS]);
  assert.equal(await purgeQueuedMedia(), 0);
  assert.equal((await rows("select id from media_deletions")).length, 1, "kept for a person to look at");
  assert.ok(world);
});

test("local uploads are removed from disk; foreign URLs are never touched", async () => {
  const name = `${createHash("sha256").update("local-erasure").digest("hex")}.png`;
  const directory = path.join(process.cwd(), "public", "uploads");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), "png");

  await removeStoredFile(`http://localhost:3100/uploads/${name}`);
  assert.equal(existsSync(path.join(directory, name)), false);

  await removeStoredFile("https://example.com/somebody-elses.png");
  assert.deepEqual(deleted(), []);
});

test("a suppression lasts while any loop can still mail the address, and goes with the last membership", async () => {
  const world = await seedWorld();
  const [{ email: alice }] = await rows<{ email: string }>("select email from memberships where id = $1", [world.alice.id]);
  await rows("insert into email_suppressions (email, reason) values ($1, 'bounce'), ($2, 'complaint')", [WREN.email.toLowerCase(), alice.toLowerCase()]);
  const suppressed = async () => (await rows<{ email: string }>("select email from email_suppressions order by email")).map((row) => row.email);

  // Wren is also in another loop, so deleting this one keeps Wren's record; Alice's last membership goes.
  await deleteLoop(world.loop.groupId);
  assert.deepEqual(await suppressed(), [WREN.email.toLowerCase()]);

  assert.deepEqual((await eraseAccount(world.userId)).ok, true);
  assert.deepEqual(await suppressed(), []);
});

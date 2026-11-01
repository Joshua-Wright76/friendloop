import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sections } from "@/db/schema";
import {
  archiveSection,
  checkMusicLink,
  createSection,
  moveSection,
  musicCardFor,
  PHOTO_WALL_MAX,
  removeSectionMediaFor,
  saveSectionMusicFor,
  saveSectionPhotoFor,
  saveSectionTextFor,
  sectionsForSheet,
} from "../../src/lib/sections.ts";
import { submitFor } from "../../src/lib/reply.ts";
import { resetDatabase, rows, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { makePng, makeWebm } from "../../e2e/support/audio.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const { sweep } = await import("../../src/lib/sweep.ts");

async function createSectionRow(input: { kind: "standard" | "photo_wall" | "music"; title: string; adminOnly?: boolean }) {
  const loop = await seedLoop();
  const created = await createSection({
    groupId: loop.groupId,
    kind: input.kind,
    title: input.title,
    emoji: null,
    description: null,
    adminOnly: input.adminOnly ?? false,
    at: new Date(),
  });
  assert.deepEqual(created, { ok: true });
  const [row] = await rows<{ id: string; group_id: string }>(
    "select id, group_id from sections where group_id = $1 order by position asc limit 1",
    [loop.groupId],
  );
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  return { loop, groupId: loop.groupId, token: alice.token, sectionId: row.id };
}

async function openSection(input?: { kind?: "standard" | "photo_wall" | "music"; adminOnly?: boolean }) {
  const base = await createSectionRow({ kind: "standard", title: "The potluck corner", adminOnly: input?.adminOnly });
  if (input?.kind && input.kind !== "standard") {
    await db.update(sections).set({ kind: input.kind }).where(eq(sections.id, base.sectionId));
  }
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string }>(
    "select i.id from issues i where i.group_id = $1 order by i.number asc limit 1",
    [base.groupId],
  );
  const [snapshot] = await rows<{ id: string }>(
    "select s.id from issue_sections s inner join issues i on i.id = s.issue_id where i.group_id = $1 order by s.position asc limit 1",
    [base.groupId],
  );
  return { ...base, issueId: issue.id, issueSectionId: snapshot.id };
}

test("link checks accept the three providers and refuse everything else", () => {
  assert.deepEqual(checkMusicLink("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"), { ok: true, provider: "spotify" });
  assert.equal(checkMusicLink("https://open.spotify.com/artist/25").ok, false);
  assert.equal(checkMusicLink("https://play.qobuz.com/album/5zwvv67f8x2zb").ok, true);
  assert.equal(checkMusicLink("https://vina.bandcamp.com/album/cc61").ok, true);
  assert.equal(checkMusicLink("https://vina.bandcamp.com/merch/shirt").ok, false);
  assert.equal(checkMusicLink("http://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC").ok, false);
  assert.equal(checkMusicLink("not a url").ok, false);
  assert.equal(checkMusicLink("https://example.com/album/123").ok, false);
});

test("music metadata answers from cache, and misses degrade to a quiet card", async () => {
  const from = "https://vina.bandcamp.com/album/cc61";

  // A fresh cache row answers directly and never reaches the network.
  await rows(
    "insert into music_links (url, provider, title, artwork_url, fetched_at) values ($1, 'bandcamp', 'CC Album', null, $2)",
    [from, new Date().toISOString()],
  );
  const cached = await musicCardFor("bandcamp", from);
  assert.equal(cached.title, "CC Album");
  assert.equal(cached.artworkUrl, null);

  // A stale row with a dead provider still answers with what it had; if it has
  // nothing, the card quietly falls back to the link's own slug.
  await rows("update music_links set fetched_at = $1 where url = $2", [new Date(Date.now() - 40 * 86400_000).toISOString(), from]);
  const stale = await musicCardFor("bandcamp", from);
  assert.equal(stale.title, "CC Album");

  await rows("update music_links set title = null where url = $1", [from]);
  const titleless = await musicCardFor("bandcamp", from);
  assert.equal(titleless.title, "cc61");
  assert.equal(titleless.artworkUrl, null);
});

test("sections arrive in an open round, and members answer them", async () => {
  const base = await openSection();

  const sheet = await sectionsForSheet(base.token, base.issueId);
  assert.equal(sheet.length, 1);
  assert.equal(sheet[0].title, "The potluck corner");

  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "Banana bread." })).ok, true);
  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "Banana bread, again." })).ok, true);
  const [row] = await rows<{ body: string }>("select body from section_replies limit 1");
  assert.equal(row.body, "Banana bread, again.");

  await submitFor(base.token);
  const [status] = await rows<{ status: string }>("select status from section_replies");
  assert.equal(status.status, "submitted");
});

test("bad tokens and unknown sections read as refusals, not errors", async () => {
  const base = await openSection();

  const invalid = await saveSectionTextFor({ token: "nope", issueSectionId: base.sectionId, body: "x" });
  assert.equal(invalid.ok === false && invalid.status === 404, true);

  const unknown = await saveSectionTextFor({
    token: base.token,
    issueSectionId: "00000000-0000-4000-8000-000000000000",
    body: "x",
  });
  assert.equal(unknown.ok === false && unknown.status === 409, true);

  const lonely = await createSectionRow({ kind: "music", title: "Music only" });
  const kindMismatch = await saveSectionMusicFor({
    token: lonely.token,
    issueSectionId: "00000000-0000-4000-8000-000000000000",
    url: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    caption: "",
  });
  assert.equal(kindMismatch.ok === false && kindMismatch.status === 409, true);

  // A live snapshot of the wrong kind refuses section music politely.
  const standard = await openSection();
  const refusedMusic = await saveSectionMusicFor({
    token: standard.token,
    issueSectionId: standard.issueSectionId,
    url: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    caption: "",
  });
  assert.equal(refusedMusic.ok === false && refusedMusic.status === 400, true);
});

test("music sections store the provider and clear cleanly", async () => {
  const base = await openSection({ kind: "music" });

  const wrongLink = await saveSectionMusicFor({ token: base.token, issueSectionId: base.issueSectionId, url: "https://example.com/album/1", caption: "" });
  assert.equal(wrongLink.ok === false && wrongLink.status === 400, true);

  assert.equal(
    (await saveSectionMusicFor({
      token: base.token,
      issueSectionId: base.issueSectionId,
      url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      caption: "Our road trip record",
    })).ok,
    true,
  );
  const [row] = await rows<{ link_url: string; link_provider: string; body: string }>("select link_url, link_provider, body from section_replies");
  assert.match(row.link_url, /open\.spotify\.com\/track/);
  assert.equal(row.link_provider, "spotify");
  assert.equal(row.body, "Our road trip record");

  assert.equal((await saveSectionMusicFor({ token: base.token, issueSectionId: base.issueSectionId, url: "", caption: "" })).ok, true);
  const [cleared] = await rows<{ link_url: string | null }>("select link_url from section_replies");
  assert.equal(cleared.link_url, null);
});

test("standard sections take one photo; walls take one caption per photo up to six", async () => {
  const base = await openSection();
  const png = () => new Uint8Array(makePng());

  assert.equal((await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 })).ok, true);
  const second = await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 1 });
  assert.equal(second.ok === false && second.status === 409, true);

  const invalid = await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: new Uint8Array(makeWebm()), contentType: "audio/webm", caption: "", position: 0 });
  assert.equal(invalid.ok === false && invalid.status === 415, true);

  // A music snapshot refuses photos the same way.
  const music = await openSection({ kind: "music" });
  const wrongKind = await saveSectionPhotoFor({ token: music.token, issueSectionId: music.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 });
  assert.equal(wrongKind.ok === false && wrongKind.status === 400, true);

  const unknown = await removeSectionMediaFor({ token: base.token, issueSectionId: base.issueSectionId, mediaId: "00000000-0000-4000-8000-000000000000" });
  assert.equal(unknown.ok === false && unknown.status === 404, true);

  const [media] = await rows<{ id: string; url: string }>("select id, url from section_media limit 1");
  assert.match(media.url, /\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal((await removeSectionMediaFor({ token: base.token, issueSectionId: base.issueSectionId, mediaId: media.id })).ok, true);
  assert.equal((await rows("select 1 from section_media")).length, 0);
  assert.equal(existsSync(path.join(process.cwd(), "public", "uploads", media.url.split("/").at(-1)!)), false);

  // A six-photo wall caps the seventh, and a caption-less wall photo never lands.
  const capless = await openSection({ kind: "photo_wall" });
  for (let index = 0; index < PHOTO_WALL_MAX; index += 1) {
    assert.equal(
      (await saveSectionPhotoFor({
        token: capless.token,
        issueSectionId: capless.issueSectionId,
        bytes: png(),
        contentType: "image/png",
        caption: `Photo ${index + 1}`,
        position: index,
      })).ok,
      true,
    );
  }
  const capped = await saveSectionPhotoFor({ token: capless.token, issueSectionId: capless.issueSectionId, bytes: png(), contentType: "image/png", caption: "Seventh", position: 6 });
  assert.equal(capped.ok === false && capped.status === 409, true);

  // A caption-less wall photo never lands.
  const captionless = await saveSectionPhotoFor({ token: capless.token, issueSectionId: capless.issueSectionId, bytes: png(), contentType: "image/png", caption: "  ", position: 1 });
  assert.equal(captionless.ok === false && captionless.status === 400, true);

  // The sheet restates the wall, captions included.
  const wallSheet = await sectionsForSheet(capless.token, capless.issueId);
  assert.equal((wallSheet[0].media ?? []).length, PHOTO_WALL_MAX);
  assert.ok(wallSheet[0].media.every((item) => item.caption && item.caption.length > 0));
});

test("admin-only sections hide from members but answer for owners", async () => {
  const loop = await seedLoop();
  await createSection({ groupId: loop.groupId, kind: "standard", title: "Committee notes", emoji: null, description: null, adminOnly: true, at: new Date() });
  await createSection({ groupId: loop.groupId, kind: "standard", title: "Open notes", emoji: null, description: null, adminOnly: false, at: new Date() });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string }>("select id from issues order by number asc limit 1");

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const memberSheet = await sectionsForSheet(alice.token, issue.id);
  assert.equal(memberSheet.length, 1);
  assert.equal(memberSheet[0].title, "Open notes");

  const ownerSheet = await sectionsForSheet(loop.ownerToken, issue.id);
  assert.equal(ownerSheet.length, 2);

  // Members can only write inside what they can see.
  const memberWrite = await saveSectionTextFor({ token: alice.token, issueSectionId: memberSheet[0].id, body: "open answer" });
  assert.equal(memberWrite.ok, true);
  const hiddenWrite = await rows<{ id: string }>("select id from issue_sections where title = 'Committee notes'");
  const refused = await saveSectionTextFor({ token: alice.token, issueSectionId: hiddenWrite[0].id, body: "sneak" });
  assert.equal(refused.ok === false && refused.status === 403, true);

  const ownerWrite = await saveSectionTextFor({ token: loop.ownerToken, issueSectionId: ownerSheet[1].id, body: "owner answer" });
  assert.equal(ownerWrite.ok, true);
});

test("owners shape the section list; archived sections leave future rounds", async () => {
  const loop = await seedLoop();
  assert.deepEqual(
    await createSection({ groupId: loop.groupId, kind: "standard", title: "The potluck corner", emoji: null, description: null, adminOnly: false, at: new Date() }),
    { ok: true },
  );
  assert.deepEqual(
    await createSection({ groupId: loop.groupId, kind: "music", title: "Music picks", emoji: null, description: null, adminOnly: false, at: new Date() }),
    { ok: true },
  );
  assert.equal((await createSection({ groupId: loop.groupId, kind: "standard", title: "   ", emoji: null, description: null, adminOnly: false, at: new Date() })).ok, false);
  assert.equal((await createSection({ groupId: loop.groupId, kind: "standard", title: "a".repeat(81), emoji: null, description: null, adminOnly: false, at: new Date() })).ok, false);

  const [musicSection] = await rows<{ id: string }>("select id from sections where title = 'Music picks'");
  await moveSection({ groupId: loop.groupId, sectionId: musicSection.id, targetIndex: 0 });
  const order = await rows<{ title: string }>("select title from sections order by position asc");
  assert.equal(order[0].title, "Music picks");

  await archiveSection({ groupId: loop.groupId, sectionId: musicSection.id, at: new Date() });
  const remaining = await rows<{ title: string }>("select title from sections where archived_at is null order by position asc");
  assert.equal(remaining.length, 1);

  // The dashboard's pool read sees the same list.
  const sectionsModule = await import("../../src/lib/sections.ts");
  const pool = await sectionsModule.sectionsOf(loop.groupId);
  assert.deepEqual(pool.map((row) => row.title), ["The potluck corner"]);
});

test("metadata fetches fill the cache wall-clock style", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const spotifyUrl = "https://open.spotify.com/album/awaywaywaywooo";
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ title: "Late Night Vinyl", thumbnail_url: "https://img.example/late.png" }), { status: 200 })) as typeof fetch;
  const fetched = await musicCardFor("spotify", spotifyUrl);
  assert.equal(fetched.title, "Late Night Vinyl");
  assert.equal(fetched.artworkUrl, "https://img.example/late.png");
  const [stored] = await rows<{ title: string; artwork_url: string }>("select title, artwork_url from music_links where url = $1", [spotifyUrl]);
  assert.equal(`${stored.title}/${stored.artwork_url}`, "Late Night Vinyl/https://img.example/late.png");

  globalThis.fetch = (async () =>
    new Response('<meta property="og:title" content="Très &#39;Quiet&#39; Night"><meta property="og:image" content="https://img.example/q.png">', { status: 200 })) as typeof fetch;
  const qobuzUrl = "https://play.qobuz.com/album/trs-quiet-night";
  await rows("delete from music_links where url = $1", [qobuzUrl]);
  const qobuz = await musicCardFor("qobuz", qobuzUrl);
  assert.equal(qobuz.title, "Très 'Quiet' Night");
  assert.equal(qobuz.artworkUrl, "https://img.example/q.png");

  await rows("delete from music_links where url = $1", [qobuzUrl]);
  globalThis.fetch = (async () => new Response("<html>", { status: 200 })) as typeof fetch;
  const empty = await musicCardFor("qobuz", qobuzUrl);
  assert.equal(empty.title, "trs quiet night");

  await rows("delete from music_links where url = $1", [qobuzUrl]);
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  const offline = await musicCardFor("qobuz", qobuzUrl);
  assert.equal(offline.title, "trs quiet night");
});

test("gates cover expired links, readers, cap-sized bodies, and fresh accepts", async () => {
  const base = await openSection();

  await rows("update memberships set participation = 'reader' where reply_token = $1", [base.token]);
  const reader = await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "x" });
  assert.equal(reader.ok === false && reader.status === 403, true);

  await rows("update memberships set participation = 'contributor', accepted_at = null, invited_at = $1 where reply_token = $2", ["2025-12-01T00:00:00Z", base.token]);
  const expired = await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "x" });
  assert.equal(expired.ok === false && expired.status === 403, true);

  await rows("update memberships set participation = 'contributor', accepted_at = null, invited_at = $1 where reply_token = $2", [new Date().toISOString(), base.token]);
  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "First write here." })).ok, true);
  const [accepted] = await rows<{ accepted_at: string }>("select accepted_at from memberships where reply_token = $1", [base.token]);
  assert.ok(accepted.accepted_at, "a first write accepts the invite");

  const oversized = await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "a".repeat(2001) });
  assert.equal(oversized.ok === false && oversized.status === 400, true);

  // An invalid token has no sheet at all.
  assert.deepEqual(await sectionsForSheet("nope", base.issueId), []);
});

test("owner edits ride updateSection, and inactive sections leave future rounds", async () => {
  const { groupId, sectionId } = await createSectionRow({ kind: "music", title: "Music picks" });
  const sectionsModule = await import("../../src/lib/sections.ts");

  assert.deepEqual(
    await sectionsModule.updateSection({ groupId, sectionId, title: "New music", emoji: "🎵", description: "Desk picks only", adminOnly: false, active: false }),
    { ok: true },
  );
  const [edited] = await rows<{ title: string; active: boolean }>("select title, active from sections where id = $1", [sectionId]);
  assert.equal(`${edited.title}:${edited.active}`, "New music:false");

  assert.equal((await sectionsModule.updateSection({ groupId, sectionId, title: "", emoji: null, description: null, adminOnly: false, active: true })).ok, false);
  assert.equal((await sectionsModule.updateSection({ groupId, sectionId, title: "a".repeat(81), emoji: null, description: null, adminOnly: false, active: true })).ok, false);

  // An inactive section no longer lands in future snapshots.
  await (await import("../../src/lib/sweep.ts")).sweep({ at: AFTER_FIRST_SLOT });
  const snapshots = await rows<{ title: string }>(
    "select s.title from issue_sections s inner join issues i on i.id = s.issue_id where i.group_id = $1",
    [groupId],
  );
  assert.equal(snapshots.length, 0);
});

test("submitSectionsFor flips just one member's drafts; positions clamp", async () => {
  const base = await openSection();
  const [membership] = await rows<{ id: string }>("select id from memberships where reply_token = $1", [base.token]);
  const [other] = await rows<{ reply_token: string }>("select reply_token from memberships where reply_token <> $1 limit 1", [base.token]);

  await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "mine" });
  await saveSectionTextFor({ token: other.reply_token, issueSectionId: base.issueSectionId, body: "theirs" });

  const { submitSectionsFor } = await import("../../src/lib/sections.ts");
  await submitSectionsFor({ issueId: base.issueId, membershipId: membership.id, membershipAcceptedAt: null, at: new Date(), afterDelivery: true });
  const states = await rows(
    "select (case when body = 'mine' then 'mine-' || status else 'theirs-' || status end) as event from section_replies order by body",
  );
  assert.deepEqual(
    states.map((row) => row.event),
    ["mine-submitted", "theirs-draft"],
  );
});

test("wall photo positions clamp to sane slots", async () => {
  const fresh = await openSection({ kind: "photo_wall" });
  const png = () => new Uint8Array(makePng());

  const first = await saveSectionPhotoFor({ token: fresh.token, issueSectionId: fresh.issueSectionId, bytes: png(), contentType: "image/png", caption: "Pos 5.4", position: 5.4 });
  assert.equal(first.ok, true);
  const second = await saveSectionPhotoFor({ token: fresh.token, issueSectionId: fresh.issueSectionId, bytes: png(), contentType: "image/png", caption: "Pos NaN", position: Number.NaN });
  assert.equal(second.ok, true);
  const positions = await rows<{ position: number }>(
    "select position from section_media order by position asc",
  );
  // A wall slot clamps into 0–5; a nonsense position falls back to "append".
  assert.deepEqual(
    positions.map((row) => row.position),
    [1, 5],
  );
});

test("qobuz links that aren't library pages are refused like any other", () => {
  assert.equal(checkMusicLink("https://whatever.qobuz.com/merch/mug").ok, false);
  assert.equal(checkMusicLink("https://play.qobuz.com/label/shop/x").ok, true);
});

test("storage failures are warm refusals, never crashes", async (t) => {
  const originalEnv = process.env.NODE_ENV;
  const originalE2E = process.env.E2E;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  t.after(() => {
    setEnv("NODE_ENV", originalEnv);
    setEnv("E2E", originalE2E);
    setEnv("BLOB_READ_WRITE_TOKEN", originalToken);
  });

  // Production storage without a token refuses through the same wording.
  await openSection();
  const [snapshot] = await rows<{ id: string }>("select id from issue_sections limit 1");
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  const refused = await saveSectionPhotoFor({
    token: (await rows<{ reply_token: string }>("select reply_token from memberships limit 1"))[0].reply_token,
    issueSectionId: snapshot.id,
    bytes: new Uint8Array(makePng()),
    contentType: "image/png",
    caption: "",
    position: 0,
  });
  assert.equal(refused.ok === false && refused.status === 500, true);
});

test("a broken link's junk url still renders a plain card", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;

  const card = await musicCardFor("qobuz", "not a url at all");
  assert.equal(card.title, "not a url at all");
  assert.equal(card.artworkUrl, null);
});

test("a photo that cannot be cleaned up still reports the removal, loudly but safely", async (t) => {
  const { chmod } = await import("node:fs/promises");
  const uploadsDirectory = path.join(process.cwd(), "public", "uploads");
  const base = await openSection();
  const saved = await saveSectionPhotoFor({
    token: base.token,
    issueSectionId: base.issueSectionId,
    bytes: new Uint8Array(makePng()),
    contentType: "image/png",
    caption: "",
    position: 0,
  });
  assert.equal(saved.ok, true);
  const [media] = await rows<{ id: string }>("select id from section_media limit 1");

  // Unlink needs the directory, not the file: take the write bit away and the
  // removal still answers, it just logs what couldn't leave.
  await chmod(uploadsDirectory, 0o500);
  t.after(async () => { await chmod(uploadsDirectory, 0o755).catch(() => undefined); });
  const removed = await removeSectionMediaFor({ token: base.token, issueSectionId: base.issueSectionId, mediaId: media.id });
  assert.equal(removed.ok, true);
});

test("a hanging provider answers as a miss through the abort clock", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  await rows("delete from music_links where url = $1", ["https://play.qobuz.com/album/hungry-pick"]);

  // A provider that never answers: the 4-second watch aborts the read.
  globalThis.fetch = ((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  })) as typeof fetch;

  const card = await musicCardFor("qobuz", "https://play.qobuz.com/album/hungry-pick");
  assert.equal(card.title, "hungry pick");
  assert.equal(card.artworkUrl, null);
});

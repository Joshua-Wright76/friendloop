import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { checkMusicLink, musicCardFor, musicCardsFor, PHOTO_WALL_MAX } from "../../src/lib/music.ts";
import { addSection } from "../support/items.ts";
import {
  deletePhotoIfUnreferenced,
  removeSectionMediaFor,
  removeWallPhotoFor,
  saveAudioFor,
  saveDraftFor,
  saveMusicFor,
  saveSectionMusicFor,
  saveSectionPhotoFor,
  saveSectionTextFor,
  saveWallPhotoFor,
  sheetFor,
} from "../../src/lib/reply.ts";
import { storePhoto } from "../../src/lib/photo-storage.ts";
import { answeredMemberIds } from "../../src/lib/answered.ts";
import { resetDatabase, rows, seedLoop, setEnv, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { makePng, makeWebm } from "../../e2e/support/audio.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

/*
 * What were sections are items asked every round in the one list of questions
 * (docs/questions-unify-design.md): photo walls, music picks and written items.
 * Their answers are `replies` (and `reply_media` on a photo wall). A sheet loaded
 * before the switch still writes through the old section actions. Adding,
 * editing and stopping items is covered in ask-items.integration.test.ts.
 */

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const { sweep } = await import("../../src/lib/sweep.ts");

type Kind = "standard" | "photo_wall" | "music";
const png = () => new Uint8Array(makePng());
const uploaded = (url: string) => path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!);

async function createSectionRow(input: { kind: Kind; title: string; adminOnly?: boolean }) {
  const loop = await seedLoop();
  const created = await addSection({ groupId: loop.groupId, kind: input.kind, title: input.title, adminOnly: input.adminOnly });
  assert.deepEqual(created, { ok: true });
  const [row] = await rows<{ id: string }>("select id from questions where group_id = $1 and text = $2", [loop.groupId, input.title]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  return { loop, groupId: loop.groupId, token: alice.token, alice, bob, sectionId: row.id };
}

/** A section in the pool, then the round that opens with it: its snapshot is what people answer. */
async function openSection(input?: { kind?: Kind; adminOnly?: boolean }) {
  const base = await createSectionRow({ kind: input?.kind ?? "standard", title: "The potluck corner", adminOnly: input?.adminOnly });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [snapshot] = await rows<{ id: string; issue_id: string }>(
    "select id, issue_id from issue_questions where question_id = $1",
    [base.sectionId],
  );
  return { ...base, issueId: snapshot.issue_id, issueSectionId: snapshot.id };
}

/** A section the release before the switch put in the open round: copied in by the mirror triggers. */
async function legacySection(issueId: string, groupId: string, kind: Kind = "standard") {
  const [section] = await rows<{ id: string }>(
    "insert into sections (group_id, kind, title, position) values ($1, $2, 'From before', 0) returning id",
    [groupId, kind],
  );
  const [snapshot] = await rows<{ id: string }>(
    "insert into issue_sections (issue_id, section_id, kind, title, position) values ($1, $2, $3, 'From before', 0) returning id",
    [issueId, section.id, kind],
  );
  return snapshot.id;
}

test("sections arrive in an open round, and members answer them", async () => {
  const base = await openSection();

  const sheet = await sheetFor(base.token);
  assert.ok(sheet);
  // One list in round order: the loop's two questions take their turn, then the section.
  assert.deepEqual(sheet.questions.map((item) => item.text), [
    "What made you laugh this week?",
    "What are you looking forward to?",
    "The potluck corner",
  ]);
  assert.equal(sheet.questions[2].format, "written");
  assert.equal(sheet.questions[2].fromSection, false);

  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "Banana bread." })).ok, true);
  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "Banana bread, again." })).ok, true);
  const [row] = await rows<{ body: string }>("select body from replies where issue_question_id = $1", [base.issueSectionId]);
  assert.equal(row.body, "Banana bread, again.");

  // Saved is in: nothing more to press.
  assert.deepEqual([...(await answeredMemberIds(base.issueId))], [base.alice.id]);

  // Cleared back to nothing, it isn't an answer any more.
  await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "   " });
  assert.equal((await answeredMemberIds(base.issueId)).size, 0);
});

test("bad tokens, unknown items and the wrong format read as refusals, not errors", async () => {
  const base = await openSection();

  const invalid = await saveSectionTextFor({ token: "nope", issueSectionId: base.issueSectionId, body: "x" });
  assert.equal(invalid.ok === false && invalid.status === 404, true);

  const unknown = await saveSectionTextFor({ token: base.token, issueSectionId: "00000000-0000-4000-8000-000000000000", body: "x" });
  assert.equal(unknown.ok === false && unknown.status === 409, true);

  // A loop with no round open has nothing to write in.
  const lonely = await createSectionRow({ kind: "music", title: "Music only" });
  const nothingOpen = await saveSectionMusicFor({
    token: lonely.token,
    issueSectionId: "00000000-0000-4000-8000-000000000000",
    url: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    caption: "",
  });
  assert.equal(nothingOpen.ok === false && nothingOpen.status === 409, true);

  // A written item takes no music pick, and a music pick takes no text.
  const refusedMusic = await saveSectionMusicFor({
    token: base.token,
    issueSectionId: base.issueSectionId,
    url: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
    caption: "",
  });
  assert.equal(refusedMusic.ok === false && refusedMusic.status === 409, true);
  const music = await openSection({ kind: "music" });
  const refusedText = await saveDraftFor({ token: music.token, issueQuestionId: music.issueSectionId, body: "words" });
  assert.equal(refusedText.ok === false && refusedText.status === 409, true);
});

test("music picks store the provider and clear cleanly", async () => {
  const base = await openSection({ kind: "music" });

  const wrongLink = await saveMusicFor({ token: base.token, issueQuestionId: base.issueSectionId, url: "https://example.com/album/1", caption: "" });
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
  const [row] = await rows<{ link_url: string; link_provider: string; body: string }>(
    "select link_url, link_provider, body from replies where issue_question_id = $1",
    [base.issueSectionId],
  );
  assert.match(row.link_url, /open\.spotify\.com\/track/);
  assert.equal(row.link_provider, "spotify");
  assert.equal(row.body, "Our road trip record");

  const sheet = await sheetFor(base.token);
  const item = sheet!.questions.find((candidate) => candidate.id === base.issueSectionId)!;
  assert.equal(`${item.format}:${item.linkProvider}`, "music:spotify");

  assert.equal((await saveMusicFor({ token: base.token, issueQuestionId: base.issueSectionId, url: "", caption: "" })).ok, true);
  const [cleared] = await rows<{ link_url: string | null }>("select link_url from replies where issue_question_id = $1", [base.issueSectionId]);
  assert.equal(cleared.link_url, null);
});

test("an old sheet's standard-section photo is the answer's one photo, removed by the answer's id", async () => {
  const base = await openSection();

  const saved = await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: png(), contentType: "image/png", caption: "ignored", position: 0 });
  assert.ok(saved.ok);
  const [reply] = await rows<{ id: string; photo_url: string }>("select id, photo_url from replies where issue_question_id = $1", [base.issueSectionId]);
  assert.equal(saved.mediaId, reply.id, "the old sheet keeps the answer's id to take it off again");
  assert.equal(reply.photo_url, saved.url);
  assert.match(saved.url, /\/uploads\/[a-f0-9]{64}\.png$/);

  const second = await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 1 });
  assert.equal(second.ok === false && second.status === 409, true);

  const invalid = await saveSectionPhotoFor({ token: base.token, issueSectionId: base.issueSectionId, bytes: new Uint8Array(makeWebm()), contentType: "audio/webm", caption: "", position: 0 });
  assert.equal(invalid.ok === false && invalid.status === 415, true);

  // A music card refuses photos either way.
  const music = await openSection({ kind: "music" });
  const wrongKind = await saveSectionPhotoFor({ token: music.token, issueSectionId: music.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 });
  assert.equal(wrongKind.ok === false && wrongKind.status === 409, true);
  const wrongRemoval = await removeSectionMediaFor({ token: music.token, issueSectionId: music.issueSectionId, mediaId: saved.mediaId });
  assert.equal(wrongRemoval.ok === false && wrongRemoval.status === 409, true);

  assert.equal((await removeSectionMediaFor({ token: base.token, issueSectionId: base.issueSectionId, mediaId: saved.mediaId })).ok, true);
  const [after] = await rows<{ photo_url: string | null }>("select photo_url from replies where issue_question_id = $1", [base.issueSectionId]);
  assert.equal(after.photo_url, null);
  assert.equal(existsSync(uploaded(saved.url)), false);
});

test("a photo wall takes one caption per photo, up to six, through either way of writing", async () => {
  const wall = await openSection({ kind: "photo_wall" });

  // A text answer is not a photo wall's shape.
  const refusedText = await saveSectionTextFor({ token: wall.token, issueSectionId: wall.issueSectionId, body: "words" });
  assert.equal(refusedText.ok === false && refusedText.status === 409, true);

  for (let index = 0; index < PHOTO_WALL_MAX; index += 1) {
    const write = index % 2 === 0 ? saveSectionPhotoFor : (input: Parameters<typeof saveSectionPhotoFor>[0]) =>
      saveWallPhotoFor({ ...input, issueQuestionId: input.issueSectionId });
    const saved = await write({ token: wall.token, issueSectionId: wall.issueSectionId, bytes: png(), contentType: "image/png", caption: `Photo ${index + 1}`, position: index });
    assert.equal(saved.ok, true);
  }
  const capped = await saveSectionPhotoFor({ token: wall.token, issueSectionId: wall.issueSectionId, bytes: png(), contentType: "image/png", caption: "Seventh", position: 6 });
  assert.equal(capped.ok === false && capped.status === 409, true);

  const invalid = await saveWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, bytes: new Uint8Array(makeWebm()), contentType: "audio/webm", caption: "", position: 0 });
  assert.equal(invalid.ok === false && invalid.status === 415, true);

  // The sheet restates the wall, captions included.
  const sheet = await sheetFor(wall.token);
  const item = sheet!.questions.find((candidate) => candidate.id === wall.issueSectionId)!;
  assert.equal(item.format, "photo_wall");
  assert.equal(item.media.length, PHOTO_WALL_MAX);
  assert.ok(item.media.every((photo) => photo.caption && photo.caption.length > 0));

  // Taking one off: an id that isn't theirs is not found, theirs goes, file and all.
  const missing = await removeWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, mediaId: "00000000-0000-4000-8000-000000000000" });
  assert.equal(missing.ok === false && missing.status === 404, true);
  const notMine = await removeSectionMediaFor({ token: wall.bob.token, issueSectionId: wall.issueSectionId, mediaId: item.media[0].id });
  assert.equal(notMine.ok, false, "someone else's photo is never theirs to take off");
  assert.equal((await removeSectionMediaFor({ token: wall.token, issueSectionId: wall.issueSectionId, mediaId: item.media[0].id })).ok, true);
  assert.equal((await rows("select 1 from reply_media")).length, PHOTO_WALL_MAX - 1);
  assert.equal(existsSync(uploaded(item.media[0].url)), false);
});

test("owners-only items hide from members but answer for owners", async () => {
  const loop = await seedLoop();
  await addSection({ groupId: loop.groupId, title: "Committee notes", adminOnly: true });
  await addSection({ groupId: loop.groupId, title: "Open notes", adminOnly: false });
  await sweep({ at: AFTER_FIRST_SLOT });

  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const memberSheet = (await sheetFor(alice.token))!.questions.map((item) => item.text);
  assert.ok(memberSheet.includes("Open notes"));
  assert.ok(!memberSheet.includes("Committee notes"));

  const ownerSheet = (await sheetFor(loop.ownerToken))!.questions;
  assert.ok(ownerSheet.some((item) => item.text === "Committee notes"));

  const [hidden] = await rows<{ id: string }>("select id from issue_questions where text = 'Committee notes'");
  const refused = await saveSectionTextFor({ token: alice.token, issueSectionId: hidden.id, body: "sneak" });
  assert.equal(refused.ok === false && refused.status === 403, true);
  assert.equal((await saveSectionTextFor({ token: loop.ownerToken, issueSectionId: hidden.id, body: "owner answer" })).ok, true);
});

test("a birthday card never reaches the person it is about", async () => {
  const base = await openSection();
  const [card] = await rows<{ id: string }>(
    `insert into issue_questions (issue_id, text, position, format, occurrence_date, about_membership_id)
     values ($1, 'Alice''s birthday', 9, 'written', '2026-01-08', $2) returning id`,
    [base.issueId, base.alice.id],
  );
  assert.ok(!(await sheetFor(base.token))!.questions.some((item) => item.id === card.id));
  assert.ok((await sheetFor(base.bob.token))!.questions.some((item) => item.id === card.id));

  const refused = await saveDraftFor({ token: base.token, issueQuestionId: card.id, body: "Happy birthday to me" });
  assert.equal(refused.ok === false && refused.status === 409, true);
  assert.equal((await saveDraftFor({ token: base.bob.token, issueQuestionId: card.id, body: "Happy birthday, Alice!" })).ok, true);
});

test("a card copied from a section in the open round is written, without voice notes", async () => {
  const base = await openSection();
  const copied = await legacySection(base.issueId, base.groupId);

  const item = (await sheetFor(base.token))!.questions.find((candidate) => candidate.id === copied)!;
  assert.equal(`${item.format}:${item.fromSection}`, "written:true");
  assert.equal((await saveDraftFor({ token: base.token, issueQuestionId: copied, body: "Still writes" })).ok, true);
  const voice = await saveAudioFor({ token: base.token, issueQuestionId: copied, audioUrl: "/uploads/voice.webm", audioDurationMs: 2000 });
  assert.equal(voice.ok === false && voice.status === 409, true);
});

test("a photo stays on disk while any row still shows it", async () => {
  const base = await openSection({ kind: "photo_wall" });
  const url = await storePhoto(png(), { contentType: "image/png", extension: "png" });
  assert.ok(existsSync(uploaded(url)));

  // A photo-wall row points at it.
  assert.ok((await saveWallPhotoFor({ token: base.token, issueQuestionId: base.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 })).ok);
  await rows("update reply_media set url = $1", [url]);
  await deletePhotoIfUnreferenced(url);
  assert.ok(existsSync(uploaded(url)), "a wall photo still uses it");

  // The legacy copy, kept until the contract release, counts too.
  await rows("delete from reply_media");
  const [reply] = await rows<{ id: string }>("select id from replies limit 1");
  await rows(
    "insert into section_replies (id, issue_id, issue_section_id, membership_id) select id, issue_id, issue_question_id, membership_id from replies where id = $1",
    [reply.id],
  ).catch(() => undefined);
  const legacy = await legacySection(base.issueId, base.groupId, "photo_wall");
  const [legacyReply] = await rows<{ id: string }>(
    "insert into section_replies (issue_id, issue_section_id, membership_id) values ($1, $2, $3) returning id",
    [base.issueId, legacy, base.bob.id],
  );
  await rows("insert into section_media (section_reply_id, url) values ($1, $2)", [legacyReply.id, url]);
  await rows("delete from reply_media");
  await deletePhotoIfUnreferenced(url);
  assert.ok(existsSync(uploaded(url)), "the legacy copy still uses it");

  await rows("delete from section_media");
  await deletePhotoIfUnreferenced(url);
  assert.equal(existsSync(uploaded(url)), false);
});

test("gates cover readers, cap-sized bodies, and an old unopened link's first write", async () => {
  const base = await openSection();

  await rows("update memberships set participation = 'reader' where reply_token = $1", [base.token]);
  const reader = await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "x" });
  assert.equal(reader.ok === false && reader.status === 403, true);

  // Invited long ago and never opened: the link still works, and the first write counts as joining.
  await rows("update memberships set participation = 'contributor', accepted_at = null, invited_at = $1 where reply_token = $2", ["2025-01-01T00:00:00Z", base.token]);
  assert.equal((await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "First write here." })).ok, true);
  const [accepted] = await rows<{ accepted_at: string }>("select accepted_at from memberships where reply_token = $1", [base.token]);
  assert.ok(accepted.accepted_at, "a first write marks them as having joined");

  const oversized = await saveSectionTextFor({ token: base.token, issueSectionId: base.issueSectionId, body: "a".repeat(2001) });
  assert.equal(oversized.ok === false && oversized.status === 400, true);

  // An invalid token has no sheet at all.
  assert.equal(await sheetFor("nope"), null);
});

test("a wall photo needs no caption, and a blank one is stored as none", async () => {
  const wall = await openSection({ kind: "photo_wall" });
  for (const [position, caption] of ["", "   "].entries()) {
    const saved = await saveWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, bytes: png(), contentType: "image/png", caption, position });
    assert.equal(saved.ok, true);
  }
  const item = (await sheetFor(wall.token))!.questions.find((candidate) => candidate.id === wall.issueSectionId)!;
  assert.deepEqual(item.media.map((photo) => photo.caption), [null, null]);
});

test("wall photo positions clamp to sane slots", async () => {
  const fresh = await openSection({ kind: "photo_wall" });
  assert.equal((await saveWallPhotoFor({ token: fresh.token, issueQuestionId: fresh.issueSectionId, bytes: png(), contentType: "image/png", caption: "Pos 5.4", position: 5.4 })).ok, true);
  assert.equal((await saveWallPhotoFor({ token: fresh.token, issueQuestionId: fresh.issueSectionId, bytes: png(), contentType: "image/png", caption: "Pos NaN", position: Number.NaN })).ok, true);
  const positions = await rows<{ position: number }>("select position from reply_media order by position asc");
  // A wall slot clamps into 0–5; a nonsense position falls back to "append".
  assert.deepEqual(positions.map((row) => row.position), [1, 5]);
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

  const standard = await openSection();
  const wall = await openSection({ kind: "photo_wall" });
  // Production storage without a token refuses through the same wording.
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  const refusedStandard = await saveSectionPhotoFor({ token: standard.token, issueSectionId: standard.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 });
  assert.equal(refusedStandard.ok === false && refusedStandard.status === 500, true);
  const refusedWall = await saveWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 });
  assert.equal(refusedWall.ok === false && refusedWall.status === 500, true);
});

test("a photo that cannot be cleaned up still reports the removal, loudly but safely", async (t) => {
  const { chmod } = await import("node:fs/promises");
  const uploadsDirectory = path.join(process.cwd(), "public", "uploads");
  const wall = await openSection({ kind: "photo_wall" });
  const saved = await saveWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, bytes: png(), contentType: "image/png", caption: "", position: 0 });
  assert.ok(saved.ok);

  // Unlink needs the directory, not the file: take the write bit away and the
  // removal still answers, it just logs what couldn't leave.
  await chmod(uploadsDirectory, 0o500);
  t.after(async () => { await chmod(uploadsDirectory, 0o755).catch(() => undefined); });
  const removed = await removeWallPhotoFor({ token: wall.token, issueQuestionId: wall.issueSectionId, mediaId: saved.mediaId });
  assert.equal(removed.ok, true);
});

test("link checks accept the three providers and refuse everything else", () => {
  assert.deepEqual(checkMusicLink("https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3"), { ok: true, provider: "spotify" });
  assert.equal(checkMusicLink("https://open.spotify.com/artist/25").ok, false);
  assert.equal(checkMusicLink("https://play.qobuz.com/album/5zwvv67f8x2zb").ok, true);
  assert.equal(checkMusicLink("https://www.qobuz.com/us-en/playlists/john-carpenter-1/2007557").ok, true);
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

test("metadata fetches fill the cache wall-clock style", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });

  const spotifyUrl = "https://open.spotify.com/album/awaywaywaywooo";
  const embed = {
    props: { pageProps: { state: { data: { entity: {
      name: "Late Night Vinyl",
      trackList: [{ title: "Side A", subtitle: "Maya", duration: 200_000 }, { title: "Side B", subtitle: "Maya", duration: 180_000 }],
      visualIdentity: { image: [{ url: "https://img.example/late.png", maxWidth: 300 }] },
    } } } } },
  };
  let asked = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked = String(input);
    return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(embed)}</script>`, { status: 200 });
  }) as typeof fetch;
  const fetched = await musicCardFor("spotify", spotifyUrl);
  assert.equal(asked, "https://open.spotify.com/embed/album/awaywaywaywooo");
  assert.equal(fetched.title, "Late Night Vinyl");
  assert.equal(fetched.artworkUrl, "https://img.example/late.png");
  assert.equal(fetched.trackCount, 2);
  const [stored] = await rows<{ title: string; artwork_url: string; tracks: Array<{ title: string }>; track_count: number }>(
    "select title, artwork_url, tracks, track_count from music_links where url = $1",
    [spotifyUrl],
  );
  assert.equal(`${stored.title}/${stored.artwork_url}`, "Late Night Vinyl/https://img.example/late.png");
  assert.deepEqual(stored.tracks.map((track) => track.title), ["Side A", "Side B"]);
  assert.equal(stored.track_count, 2);

  // The cache now answers with the songs, without the network.
  globalThis.fetch = (async () => {
    throw new Error("cache should answer");
  }) as typeof fetch;
  const cachedSongs = await musicCardFor("spotify", spotifyUrl);
  assert.equal(cachedSongs.tracks[1].seconds, 180);

  // A failed refresh keeps the songs it had.
  await rows("update music_links set fetched_at = $1 where url = $2", [new Date(0).toISOString(), spotifyUrl]);
  const staleSongs = await musicCardFor("spotify", spotifyUrl);
  assert.equal(staleSongs.trackCount, 2);

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

test("qobuz links that aren't library pages are refused like any other", () => {
  assert.equal(checkMusicLink("https://whatever.qobuz.com/merch/mug").ok, false);
  assert.equal(checkMusicLink("https://play.qobuz.com/label/shop/x").ok, true);
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

test("many music cards come from one cache read, and only a missing one is fetched", async (t) => {
  assert.equal((await musicCardsFor([])).size, 0);

  const cached = "https://vina.bandcamp.com/album/batch-cached";
  const missing = "https://open.spotify.com/album/batchmissing";
  await rows(
    "insert into music_links (url, provider, title, artwork_url, fetched_at) values ($1, 'bandcamp', 'Cached Album', null, $2)",
    [cached, new Date().toISOString()],
  );

  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response("not a page with metadata", { status: 200 });
  }) as typeof fetch;

  const cards = await musicCardsFor([
    { provider: "bandcamp", url: cached },
    { provider: "spotify", url: missing },
    // The same link twice is fetched once.
    { provider: "spotify", url: missing },
  ]);
  assert.equal(cards.get(cached)?.title, "Cached Album");
  assert.equal(cards.get(missing)?.title, "batchmissing");
  assert.deepEqual(asked, ["https://open.spotify.com/embed/album/batchmissing"]);
});

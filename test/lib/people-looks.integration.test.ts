/*
 * What people add to a round themselves: a signature per loop, a line per round and
 * a sticker on an answer. Saved through their own credentials, shown with the round,
 * carried into its email and their export, and nothing at all when nobody chose any.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { clearMemberSignature, setMemberSignature } from "../../src/lib/identity.ts";
import { isMediaReferenced } from "../../src/lib/media-cleanup.ts";
import { saveDraftFor, saveStatusLineFor, saveStickerFor, sheetFor } from "../../src/lib/reply.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { loopArchive, replyLinkExport } from "../../src/lib/data-export.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { MAX_AVATAR_BYTES } from "../../src/lib/photo-validation.ts";
import {
  AFTER_FIRST_SLOT,
  DELIVERY_DAY,
  E2E_NOW,
  resetDatabase,
  rows,
  seedDeliveredIssue,
  seedLoop,
  seedOpenIssue,
  setupDatabase,
} from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01]);
const STROKES = [[100, 120, 140, 80, 200, 130, 260, 90], [300, 100]];
const file = (url: string) => path.join(process.cwd(), "public", "uploads", url.split("/").at(-1)!);

async function collect(chunks: AsyncGenerator<string>) {
  let out = "";
  for await (const chunk of chunks) out += chunk;
  return JSON.parse(out);
}

async function openLoop() {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  const questions = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position", [issue.issueId]);
  return { loop, issue, alice, bob, first: questions[0], second: questions[1] };
}

/* ------------------------------ signatures ------------------------------ */

test("a signature is its strokes and their picture: it replaces cleanly, clears, and is one membership's", async (t) => {
  const { alice, bob } = await openLoop();
  const saved = await setMemberSignature(alice.id, [[1.4, 2.6, 700, -5]], { bytes: PNG, type: "image/png" });
  assert.ok(saved.ok);
  t.after(() => clearMemberSignature(alice.id));
  assert.deepEqual(saved.signature, [[1, 3, 600, 0]], "the strokes are kept on the board");
  assert.ok(existsSync(file(saved.url)));
  assert.equal(await isMediaReferenced(saved.url), true, "a signature's picture is never swept up while it's in use");

  const again = await setMemberSignature(alice.id, STROKES, { bytes: PNG, type: "image/png" });
  assert.ok(again.ok);
  assert.ok(!existsSync(file(saved.url)), "the replaced picture is gone");
  const [row] = await rows<{ signature: number[][]; signature_png_url: string }>("select signature, signature_png_url from memberships where id = $1", [alice.id]);
  assert.deepEqual(row.signature, STROKES);
  assert.equal(row.signature_png_url, again.url);
  assert.equal((await rows<{ signature: unknown }>("select signature from memberships where id = $1", [bob.id]))[0].signature, null);

  await clearMemberSignature(alice.id);
  const [cleared] = await rows<{ signature: unknown; signature_png_url: unknown }>("select signature, signature_png_url from memberships where id = $1", [alice.id]);
  assert.deepEqual(cleared, { signature: null, signature_png_url: null });
  assert.ok(!existsSync(file(again.url)));
  await clearMemberSignature(alice.id);
});

test("a signature is refused when its strokes aren't strokes, its picture isn't a PNG or is too big, or nobody owns it", async () => {
  const { alice } = await openLoop();
  const invalid = "That signature didn't come through. Clear it and draw it again.";
  assert.deepEqual(await setMemberSignature(alice.id, "<svg/>", { bytes: PNG, type: "image/png" }), { ok: false, status: 400, error: invalid });
  assert.deepEqual(await setMemberSignature(alice.id, [[1, 2, 3]], { bytes: PNG, type: "image/png" }), { ok: false, status: 400, error: invalid });
  assert.deepEqual(await setMemberSignature(alice.id, STROKES, { bytes: JPEG, type: "image/jpeg" }), { ok: false, status: 415, error: invalid });
  assert.deepEqual(await setMemberSignature(alice.id, STROKES, { bytes: new TextEncoder().encode("nope"), type: "image/png" }), { ok: false, status: 415, error: invalid });
  const big = new Uint8Array(MAX_AVATAR_BYTES + 1);
  big.set(PNG);
  assert.deepEqual(await setMemberSignature(alice.id, STROKES, { bytes: big, type: "image/png" }), {
    ok: false,
    status: 413,
    error: "That signature is too big to save. Clear it and draw a simpler one.",
  });
  const missing = await setMemberSignature("00000000-0000-4000-8000-000000000000", STROKES, { bytes: PNG, type: "image/png" });
  assert.deepEqual(missing, { ok: false, status: 404, error: "Your signature didn't save. Try again." });
  assert.equal((await rows<{ signature: unknown }>("select signature from memberships where id = $1", [alice.id]))[0].signature, null);
});

/* -------------------------------- stickers -------------------------------- */

test("a sticker sticks to an answer, peels off, and only ours are taken", async () => {
  const { alice, first, second } = await openLoop();
  await saveDraftFor({ token: alice.token, issueQuestionId: first.id, body: "A goose." });

  assert.deepEqual((await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "frog" })).ok, true);
  const stickerOf = async (questionId: string) =>
    (await rows<{ sticker: string | null; body: string }>("select sticker, body from replies where issue_question_id = $1 and membership_id = $2", [questionId, alice.id]))[0];
  assert.deepEqual(await stickerOf(first.id), { sticker: "frog", body: "A goose." }, "the words stay as they were");

  const refused = await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "frog.svg" });
  assert.deepEqual(refused, { ok: false, status: 400, error: "That isn't one of our stickers." });
  assert.equal((await stickerOf(first.id)).sticker, "frog");

  await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "" });
  assert.equal((await stickerOf(first.id)).sticker, null);

  // Ahead of its answer's first save it makes the row, which still shows nothing until there are words.
  await saveStickerFor({ token: alice.token, issueQuestionId: second.id, sticker: "moon" });
  assert.deepEqual(await stickerOf(second.id), { sticker: "moon", body: "" });
  const sheet = await sheetFor(alice.token);
  assert.deepEqual(sheet?.questions.map((question) => question.sticker), [null, "moon"]);

  const unknown = await saveStickerFor({ token: "never-issued", issueQuestionId: first.id, sticker: "frog" });
  assert.equal(!unknown.ok && unknown.status, 404);
  const elsewhere = await saveStickerFor({ token: alice.token, issueQuestionId: "00000000-0000-4000-8000-000000000000", sticker: "frog" });
  assert.equal(!elsewhere.ok && elsewhere.status, 409);
});

/* ---------------------------- a line per round ---------------------------- */

test("a line is one short line for the open round: it saves cleaned, changes, and goes when emptied", async () => {
  const { alice, bob, issue } = await openLoop();
  const lineOf = async () => (await rows<{ body: string }>("select body from issue_status_lines where issue_id = $1 and membership_id = $2", [issue.issueId, alice.id]))[0]?.body ?? null;

  assert.equal((await sheetFor(alice.token))?.line, "");
  assert.deepEqual((await saveStatusLineFor({ token: alice.token, body: "  knee-deep\nin   moving boxes 📦 " })).ok, true);
  assert.equal(await lineOf(), "knee-deep in moving boxes 📦");
  assert.equal((await sheetFor(alice.token))?.line, "knee-deep in moving boxes 📦");

  await saveStatusLineFor({ token: alice.token, body: `${"a".repeat(70)}` });
  assert.equal(await lineOf(), "a".repeat(60));
  await saveStatusLineFor({ token: bob.token, body: "off to Lisbon" });
  await saveStatusLineFor({ token: alice.token, body: "   " });
  assert.equal(await lineOf(), null);
  assert.equal((await rows("select id from issue_status_lines")).length, 1, "Bob's line is his own");

  const unknown = await saveStatusLineFor({ token: "never-issued", body: "x" });
  assert.equal(!unknown.ok && unknown.status, 404);
  await rows("update groups set paused_at = now()");
  const paused = await saveStatusLineFor({ token: alice.token, body: "x" });
  assert.equal(!paused.ok && paused.status, 409);
});

/* ----------------------------- on the round ----------------------------- */

test("a round that nobody added anything to has no roll call, no signatures and no stickers", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: E2E_NOW, answers: [{ email: "alice@friendloop.test", body: "Hi" }] });
  const view = await loadIssue({ issueId: delivered.issueId, viewerMembershipId: null });
  assert.ok(view);
  assert.equal("statusLines" in view, false);
  assert.equal("signatures" in view, false);
  assert.equal("sticker" in view.blocks[0].answers[0], false);
});

test("before the round goes out only your own line shows; once it has, everyone's, and the signatures of those who wrote", async () => {
  const { loop, issue, alice, bob, first, second } = await openLoop();
  const sam = loop.members.find((member) => member.email.startsWith("owner"))!;
  await saveDraftFor({ token: alice.token, issueQuestionId: first.id, body: "A goose." });
  await saveDraftFor({ token: bob.token, issueQuestionId: second.id, body: "Owners only." });
  await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "peach" });
  await saveStatusLineFor({ token: alice.token, body: "📚 reading Middlemarch" });
  await saveStatusLineFor({ token: bob.token, body: "off to Lisbon" });
  await rows("update memberships set signature = $2 where id = any($1::uuid[])", [[alice.id, bob.id, sam.id], JSON.stringify(STROKES)]);
  // Bob's only answer is to an owners-only item; Sam signs but wrote nothing.
  await rows("update issue_questions set admin_only = true where id = $1", [second.id]);

  const open = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  assert.deepEqual(open?.statusLines?.map((line) => line.body), ["off to Lisbon"]);
  assert.equal(open?.signatures, undefined, "signatures close a round that has gone out");

  await rows("update issues set status = 'delivered', delivered_at = now() where id = $1", [issue.issueId]);
  const member = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  assert.deepEqual(member?.statusLines?.map((line) => [line.name, line.body]), [["Alice", "📚 reading Middlemarch"], ["Bob", "off to Lisbon"]]);
  assert.deepEqual(member?.signatures?.map((signature) => signature.name), ["Alice"], "Bob's words are hidden here, so he doesn't sign; Sam wrote nothing");
  assert.deepEqual(member?.signatures?.[0].strokes, STROKES);
  assert.equal(member?.blocks[0].answers[0].sticker, "peach");

  const owner = await loadIssue({ issueId: issue.issueId, viewerMembershipId: sam.id, viewerIsAdmin: true });
  assert.deepEqual(owner?.signatures?.map((signature) => signature.name), ["Alice", "Bob"]);
});

test("a sticker on a photo wall or music pick shows on its card too", async () => {
  const { alice, issue, first } = await openLoop();
  await rows("update issue_questions set format = 'music', from_section = true where id = $1", [first.id]);
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, link_url, link_provider, sticker, status, submitted_at) values ($1, $2, $3, 'On repeat', 'https://open.spotify.com/track/1', 'spotify', 'star', 'submitted', now())",
    [issue.issueId, first.id, alice.id],
  );
  await rows("update issues set status = 'delivered', delivered_at = now() where id = $1", [issue.issueId]);
  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: null });
  assert.equal(view?.sections[0].replies[0].sticker, "star");
});

/* ------------------------------ in the email ------------------------------ */

test("the round's email opens with the roll call, puts stickers by names and closes with the signed card", async (t) => {
  const { issue, alice, bob, first, second } = await openLoop();
  await saveDraftFor({ token: alice.token, issueQuestionId: first.id, body: "A goose." });
  await saveDraftFor({ token: bob.token, issueQuestionId: second.id, body: "Owners only." });
  await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "peach" });
  await saveStatusLineFor({ token: alice.token, body: "📚 reading Middlemarch" });
  await saveStatusLineFor({ token: bob.token, body: "off to Lisbon" });
  const signed = await setMemberSignature(alice.id, STROKES, { bytes: PNG, type: "image/png" });
  const bobSigned = await setMemberSignature(bob.id, STROKES, { bytes: PNG, type: "image/png" });
  assert.ok(signed.ok && bobSigned.ok);
  t.after(async () => {
    await clearMemberSignature(alice.id);
    await clearMemberSignature(bob.id);
  });
  await rows("update issue_questions set admin_only = true where id = $1", [second.id]);

  await sweep({ at: DELIVERY_DAY });
  const mails = await rows<{ to: string; html: string; text: string }>("select \"to\", html, text from outbox where kind = 'delivery' and issue_id = $1", [issue.issueId]);
  const to = (who: string) => mails.find((mail) => mail.to === who)!;
  const forAlice = to("alice@friendloop.test");
  assert.match(forAlice.html, />Who&#39;s here this round<\/h2>/);
  assert.match(forAlice.html, />Alice<\/td><td[^>]*>📚 reading Middlemarch<\/td>/);
  assert.match(forAlice.html, /\/stickers\/png\/peach\.png/);
  assert.match(forAlice.html, new RegExp(`<img src="${signed.url.replace(/[.?]/g, "\\$&")}" alt="Signed, Alice"`));
  assert.doesNotMatch(forAlice.html, /alt="Signed, Bob"/, "Bob signs only where his words are shown");
  assert.match(forAlice.text, /Who's here this round\nAlice: 📚 reading Middlemarch\nBob: off to Lisbon\n/);
  assert.match(forAlice.text, /Signed, sealed, delivered: Alice$/m);
  assert.match(to("owner@friendloop.test").html, /alt="Signed, Bob"/);
});

/* ------------------------------ in the export ------------------------------ */

test("a person's export carries their signature, their lines and their stickers; the loop's archive the lines and stickers", async () => {
  const { loop, issue, alice, bob, first } = await openLoop();
  await saveDraftFor({ token: alice.token, issueQuestionId: first.id, body: "A goose." });
  await saveStickerFor({ token: alice.token, issueQuestionId: first.id, sticker: "peach" });
  await saveStatusLineFor({ token: bob.token, body: "mostly sleeping" });
  await saveStatusLineFor({ token: alice.token, body: "off to Lisbon" });
  await rows("update memberships set signature = $2, signature_png_url = '/uploads/sig.png' where id = $1", [alice.id, JSON.stringify(STROKES)]);

  const person = await replyLinkExport(alice.token, E2E_NOW);
  const [mine] = (await collect(person!.chunks)).loops;
  assert.deepEqual(mine.you.signature, { strokes: STROKES, pngUrl: "http://localhost:3100/uploads/sig.png" });
  assert.deepEqual(mine.roundLines.map((line: { round: number; line: string }) => [line.round, line.line]), [[1, "off to Lisbon"]]);
  assert.equal(mine.answers[0].sticker, "peach");

  await rows("update issues set status = 'delivered', delivered_at = now() where id = $1", [issue.issueId]);
  const archive = await collect((await loopArchive(loop.groupId, E2E_NOW))!.chunks);
  assert.deepEqual(archive.rounds[0].lines, [{ by: "Alice", line: "off to Lisbon" }, { by: "Bob", line: "mostly sleeping" }]);
  assert.equal(archive.rounds[0].questions[0].answers[0].sticker, "peach");
});

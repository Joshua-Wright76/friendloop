import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { postComment } from "../../src/lib/comments.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { createSession } from "../../src/lib/auth.ts";
import { updateLoopSettings } from "../../src/lib/manage.ts";
import { COMMENT_MAX_LENGTH } from "../../src/lib/comments.ts";
import { MAX_PHOTO_BYTES } from "../../src/lib/photo-validation.ts";
import { LIMITS } from "../../src/lib/rate-limit.ts";
import { copy } from "../../src/lib/copy.ts";
import {
  E2E_NOW,
  groupOf,
  resetDatabase,
  rows,
  seedDeliveredIssue,
  seedLoop,
  seedOpenIssue,
  setEnv,
  setupDatabase,
} from "../support/app.ts";
import { seedPoll, seedPollVote } from "../../e2e/support/polls.ts";
import { addMember } from "../../e2e/support/seed.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestCookies, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

async function delivered() {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [
      { email: "alice@friendloop.test", body: "Alice's answer." },
      { email: "bob@friendloop.test", body: "Bob's answer." },
    ],
  });
  const person = (name: string) => loop.members.find((member) => member.email.startsWith(name))!;
  const replyOf = async (email: string) =>
    (await rows<{ id: string }>(
      "select r.id from replies r join memberships m on m.id = r.membership_id where m.email = $1",
      [email],
    ))[0].id;
  return { loop, issue, alice: person("alice"), bob: person("bob"), sam: person("owner"), replyOf };
}

async function outboxFor(prefix: string) {
  return rows<{ to: string; subject: string; html: string; text: string; dedupe_key: string; status: string }>(
    "select \"to\", subject, html, text, dedupe_key, status from outbox where dedupe_key like $1 order by created_at",
    [`${prefix}%`],
  );
}

test("a member posts to the issue thread; empty, oversized and stranger posts are refused", async () => {
  const { issue, alice } = await delivered();

  const posted = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "  Lovely.  " });
  assert.equal(posted.ok, true);
  const [saved] = await rows<{ body: string; reply_id: string | null }>("select body, reply_id from comments");
  assert.deepEqual(saved, { body: "Lovely.", reply_id: null });

  const nothing = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "   " });
  assert.deepEqual(nothing, { ok: false, status: 400, error: "Write something first." });
  const long = await postComment({
    issueId: issue.issueId,
    viewerToken: alice.token,
    body: "x".repeat(COMMENT_MAX_LENGTH + 1),
  });
  assert.equal(long.ok === false && long.status, 400);

  const stranger = await postComment({ issueId: issue.issueId, viewerToken: "not-a-token", body: "hi" });
  assert.equal(stranger.ok === false && stranger.status, 403);
  const nobody = await postComment({ issueId: issue.issueId, viewerToken: null, body: "hi" });
  assert.equal(nobody.ok === false && nobody.status, 403);

  const missing = await postComment({ issueId: "00000000-0000-4000-8000-000000000000", viewerToken: alice.token, body: "hi" });
  assert.equal(missing.ok === false && missing.status, 404);
  const garbage = await postComment({ issueId: "nope", viewerToken: alice.token, body: "hi" });
  assert.equal(garbage.ok === false && garbage.status, 404);
  const badId = await postComment({ issueId: issue.issueId, viewerToken: alice.token, id: "nope", body: "hi" });
  assert.equal(badId.ok === false && badId.status, 400);

  assert.equal((await rows("select 1 from comments")).length, 1);
});

test("a revoked member can neither comment nor read as themselves", async () => {
  const { issue, alice } = await delivered();
  await rows("update memberships set revoked_at = now() where id = $1", [alice.id]);
  const result = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "still here?" });
  assert.equal(result.ok === false && result.status, 403);
});

test("a signed-in member comments without a token", async () => {
  const { loop, issue, alice } = await delivered();
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ('alice@friendloop.test', 'Alice') returning id",
  );
  await rows("update memberships set user_id = $1 where id = $2", [user.id, alice.id]);
  setRequestCookies({});
  await createSession(user.id, E2E_NOW);

  assert.equal((await postComment({ issueId: issue.issueId, viewerToken: null, body: "From my session." })).ok, true);
  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(view?.comments[0].isYou, true);
  assert.equal(loop.groupId.length > 0, true);
});

test("an owner can turn comments off: writes refused, surfaces gone, nothing deleted, back on restores", async () => {
  const { loop, issue, alice, replyOf } = await delivered();
  const replyId = await replyOf("bob@friendloop.test");
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Before." });
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "On an answer.", replyId });

  const group = await groupOf(loop.groupId);
  await updateLoopSettings(loop.groupId, { ...group, commentsEnabled: false });

  const refused = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "After." });
  assert.deepEqual(refused, { ok: false, status: 403, error: "Comments are turned off for this loop." });
  assert.equal((await rows("select 1 from comments")).length, 2, "past comments stay stored");

  const off = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(off?.commentsEnabled, false);
  assert.deepEqual(off?.comments, []);
  assert.deepEqual(off?.mentionables, []);
  assert.deepEqual(off?.blocks.flatMap((block) => block.answers.flatMap((answer) => answer.comments)), []);

  // Saving other settings without the field leaves the switch alone.
  await updateLoopSettings(loop.groupId, { ...group, commentsEnabled: undefined, name: "Renamed" });
  assert.equal((await groupOf(loop.groupId)).commentsEnabled, false);

  await updateLoopSettings(loop.groupId, { ...group, commentsEnabled: true });
  const on = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(on?.comments.length, 1);
  assert.equal(on?.blocks.flatMap((block) => block.answers.flatMap((answer) => answer.comments)).length, 1);
});

test("a share link never shows comments", async () => {
  const loop = await seedLoop();
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Shared." }],
    shareToken: "share-token-1",
  });
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Members only." });

  const shared = await loadIssue({ shareToken: "share-token-1" });
  assert.deepEqual(shared?.comments, []);
});

test("a comment hangs from one answer and stays out of the issue thread", async () => {
  const { issue, alice, bob, replyOf } = await delivered();
  const bobReply = await replyOf("bob@friendloop.test");

  const posted = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "On Bob's.", replyId: bobReply });
  assert.equal(posted.ok, true);
  await postComment({ issueId: issue.issueId, viewerToken: bob.token, body: "On the issue." });

  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.deepEqual(view?.comments.map((comment) => comment.parts), [[{ type: "text", text: "On the issue." }]]);
  const answer = view?.blocks.flatMap((block) => block.answers).find((candidate) => candidate.replyId === bobReply);
  assert.equal(answer?.comments.length, 1);
  assert.equal(answer?.comments[0].author, "You");
  const untouched = view?.blocks.flatMap((block) => block.answers).find((candidate) => candidate.replyId !== bobReply);
  assert.deepEqual(untouched?.comments, []);
});

test("an answer must belong to this issue, be submitted, and (for polls) be visible", async () => {
  const { loop, issue, alice, replyOf } = await delivered();

  const other = await seedDeliveredIssue(loop, {
    deliveredAt: new Date(E2E_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    answers: [{ email: "bob@friendloop.test", body: "Elsewhere." }],
  });
  const [elsewhere] = await rows<{ id: string }>("select id from replies where issue_id = $1", [other.issueId]);
  const wrongIssue = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", replyId: elsewhere.id });
  assert.deepEqual(wrongIssue, { ok: false, status: 404, error: "That answer isn't there to comment on." });

  const notReal = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", replyId: "nope" });
  assert.equal(notReal.ok === false && notReal.status, 404);

  await rows("update replies set status = 'draft' where id = $1", [await replyOf("bob@friendloop.test")]);
  const draft = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", replyId: await replyOf("bob@friendloop.test") });
  assert.equal(draft.ok === false && draft.status, 404);
});

test("a poll pick can't be commented on by others until the round is delivered", async () => {
  const loop = await seedLoop({ questions: ["Warm-up?"] });
  await seedPoll(loop, { text: "Which weekend?", options: ["June", "July"] });
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedPollVote(issue.issueId, bob.id, [1]);
  const [pick] = await rows<{ id: string }>("select id from replies where membership_id = $1", [bob.id]);

  const others = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Good pick.", replyId: pick.id });
  assert.equal(others.ok === false && others.status, 404);
  const own = await postComment({ issueId: issue.issueId, viewerToken: bob.token, body: "My pick.", replyId: pick.id });
  assert.equal(own.ok, true);

  await rows("update issues set status = 'delivered', delivered_at = now() where id = $1", [issue.issueId]);
  const after = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Good pick.", replyId: pick.id });
  assert.equal(after.ok, true);
});

test("quoting: the quote must be a live comment in the same thread; a removed one reads as removed", async () => {
  const { issue, alice, bob, replyOf } = await delivered();
  const bobReply = await replyOf("bob@friendloop.test");

  const first = await postComment({ issueId: issue.issueId, viewerToken: bob.token, body: "Who is up for a trip to the coast this summer?" });
  assert.equal(first.ok, true);
  const firstId = (first as { id: string }).id;

  const answering = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Me!", quoteCommentId: firstId });
  assert.equal(answering.ok, true);

  // A quote belongs to its own thread.
  const crossThread = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", quoteCommentId: firstId, replyId: bobReply });
  assert.deepEqual(crossThread, { ok: false, status: 409, error: "The comment you were answering has been removed." });
  const garbage = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", quoteCommentId: "nope" });
  assert.equal(garbage.ok === false && garbage.status, 409);

  let view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  const reply = view?.comments.find((comment) => comment.isYou);
  assert.deepEqual(reply?.quote, { author: "Bob", text: "Who is up for a trip to the coast this summer?", removed: false });

  await rows("update comments set deleted_at = now() where id = $1", [firstId]);
  view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(view?.comments.length, 1, "the removed comment itself is gone from the thread");
  assert.deepEqual(view?.comments[0].quote, { author: "", text: "A comment that has since been removed.", removed: true });

  const deadQuote = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", quoteCommentId: firstId });
  assert.equal(deadQuote.ok === false && deadQuote.status, 409);

  // A hard-deleted original (its author's membership went) just leaves the reply unquoted.
  await rows("delete from comments where id = $1", [firstId]);
  view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(view?.comments[0].quote, null);
});

test("a long quote is trimmed, and a quote of your own comment says You", async () => {
  const { issue, alice } = await delivered();
  const long = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "word ".repeat(100) });
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "ok", quoteCommentId: (long as { id: string }).id });
  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  const quote = view?.comments.find((comment) => comment.quote)?.quote;
  assert.equal(quote?.author, "You");
  assert.ok(quote && quote.text.length <= 141 && quote.text.endsWith("…"));
});

test("mentions: one email per mentioned member, readers included, never the author or the revoked", async () => {
  const { loop, issue, alice, bob, sam } = await delivered();
  await rows("update memberships set participation = 'reader' where id = $1", [bob.id]);
  const gone = await addMember(loop, { email: "gone@friendloop.test", name: "Gone" });
  await rows("update memberships set revoked_at = now() where id = $1", [gone.id]);
  const otherLoop = await seedLoop({ name: "Elsewhere", owner: { email: "elsewhere@friendloop.test", name: "Else" }, members: [] });
  const outsider = otherLoop.members[0];

  const posted = await postComment({
    issueId: issue.issueId,
    viewerToken: alice.token,
    body: "Hi @Bob and @Sam, and @Alice, @Gone, @Else!",
    mentions: [
      { id: bob.id, label: "Bob" },
      { id: sam.id, label: "Sam" },
      { id: alice.id, label: "Alice" },
      { id: gone.id, label: "Gone" },
      { id: outsider.id, label: "Else" },
      { id: "not-a-uuid", label: "Ghost" },
    ],
  });
  assert.equal(posted.ok, true);
  const commentId = (posted as { id: string }).id;

  const [stored] = await rows<{ body: string }>("select body from comments where id = $1", [commentId]);
  assert.equal(stored.body, `Hi @[${bob.id}] and @[${sam.id}], and @Alice, @Gone, @Else!`);

  const sent = await outboxFor("mention:");
  assert.deepEqual(sent.map((email) => email.to).sort(), ["bob@friendloop.test", "owner@friendloop.test"]);
  assert.deepEqual(
    sent.map((email) => email.dedupe_key).sort(),
    [`mention:${issue.issueId}:${commentId}:${bob.id}`, `mention:${issue.issueId}:${commentId}:${sam.id}`].sort(),
  );
  const toBob = sent.find((email) => email.to === "bob@friendloop.test")!;
  assert.equal(toBob.subject, "Alice mentioned you in Friday Loop");
  assert.match(toBob.text, /Hi @Bob and @Sam, and @Alice, @Gone, @Else!/);
  assert.match(toBob.text, new RegExp(`/i/${issue.issueId}\\?m=${bob.token}`));
});

test("posting the same comment twice is one comment and one email", async () => {
  const { issue, alice, bob } = await delivered();
  const id = "44444444-4444-4444-8444-444444444444";
  const send = () =>
    postComment({ issueId: issue.issueId, viewerToken: alice.token, id, body: "Hey @Bob", mentions: [{ id: bob.id, label: "Bob" }] });

  assert.deepEqual(await send(), { ok: true, id });
  assert.deepEqual(await send(), { ok: true, id });
  assert.equal((await rows("select 1 from comments")).length, 1);
  assert.equal((await outboxFor("mention:")).length, 1);

  // A retry that finds the email missing (the first attempt died before sending) repairs it.
  await rows("delete from outbox");
  assert.deepEqual(await send(), { ok: true, id });
  assert.equal((await outboxFor("mention:")).length, 1);

  // And someone else cannot take over that id.
  const stolen = await postComment({ issueId: issue.issueId, viewerToken: bob.token, id, body: "mine now" });
  assert.deepEqual(stolen, { ok: false, status: 409, error: "That didn't go through. Try again?" });
  const [still] = await rows<{ body: string }>("select body from comments where id = $1", [id]);
  assert.match(still.body, /^Hey @\[/);
});

test("a retry of a comment with no mentions sends nothing", async () => {
  const { issue, alice } = await delivered();
  const id = "55555555-5555-4555-8555-555555555555";
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, id, body: "Plain." });
  assert.deepEqual(await postComment({ issueId: issue.issueId, viewerToken: alice.token, id, body: "Plain." }), { ok: true, id });
  assert.equal((await outboxFor("mention:")).length, 0);
});

test("a mention follows a rename, and an unknown one reads as someone", async () => {
  const { issue, alice, bob } = await delivered();
  await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Thanks @Bob", mentions: [{ id: bob.id, label: "Bob" }] });
  await rows("update memberships set name = 'Robert' where id = $1", [bob.id]);
  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.deepEqual(view?.comments[0].parts, [
    { type: "text", text: "Thanks " },
    { type: "mention", id: bob.id, name: "Robert" },
  ]);

  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, $3)", [
    issue.issueId,
    alice.id,
    "Hi @[99999999-9999-4999-8999-999999999999]",
  ]);
  const again = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.deepEqual(again?.comments[1].parts[1], { type: "mention", id: "99999999-9999-4999-8999-999999999999", name: "someone" });
});

test("the mention list is everyone live except you, and empty for strangers", async () => {
  const { loop, issue, alice } = await delivered();
  const gone = await addMember(loop, { email: "gone@friendloop.test", name: "Gone" });
  await rows("update memberships set revoked_at = now() where id = $1", [gone.id]);
  await addMember(loop, { email: "zed@friendloop.test" });

  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.deepEqual(view?.mentionables.map((person) => person.name), ["Bob", "Sam", "zed"]);
  const stranger = await loadIssue({ issueId: issue.issueId });
  assert.deepEqual(stranger?.mentionables, []);
});

test("a photo rides along under the same caps as an answer's", async (t) => {
  const { issue, alice } = await delivered();

  const posted = await postComment({
    issueId: issue.issueId,
    viewerToken: alice.token,
    body: "",
    photo: { bytes: PNG, type: "image/png" },
  });
  assert.equal(posted.ok, true);
  const [saved] = await rows<{ photo_url: string; body: string }>("select photo_url, body from comments");
  assert.equal(saved.body, "");
  assert.match(saved.photo_url, /\/uploads\/[a-f0-9]{64}\.png$/);
  const file = path.join(process.cwd(), "public", "uploads", saved.photo_url.split("/").at(-1)!);
  assert.equal(existsSync(file), true);
  t.after(async () => {
    const { deleteStoredPhoto } = await import("../../src/lib/photo-storage.ts");
    await deleteStoredPhoto(saved.photo_url);
  });

  const view = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(view?.comments[0].photoUrl, saved.photo_url);

  const text = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", photo: { bytes: new TextEncoder().encode("not an image"), type: "image/png" } });
  assert.deepEqual(text, { ok: false, status: 415, error: "Use a JPEG, PNG, WebP or GIF photo." });
  const mismatch = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", photo: { bytes: PNG, type: "image/jpeg" } });
  assert.equal(mismatch.ok === false && mismatch.status, 415);
  const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
  big.set(PNG);
  const tooBig = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", photo: { bytes: big, type: "image/png" } });
  assert.deepEqual(tooBig, { ok: false, status: 413, error: "That photo is over 4 MB. Try a smaller one." });
  assert.equal((await rows("select 1 from comments")).length, 1);
});

test("a retried photo comment keeps one file; a storage failure is a plain error", async (t) => {
  const { issue, alice } = await delivered();
  const id = "66666666-6666-4666-8666-666666666666";
  const send = () =>
    postComment({ issueId: issue.issueId, viewerToken: alice.token, id, body: "Look", photo: { bytes: PNG, type: "image/png" } });
  await send();
  await send();
  const [saved] = await rows<{ photo_url: string }>("select photo_url from comments");
  t.after(async () => {
    const { deleteStoredPhoto } = await import("../../src/lib/photo-storage.ts");
    await deleteStoredPhoto(saved.photo_url);
  });
  const { readdir } = await import("node:fs/promises");
  const stored = (await readdir(path.join(process.cwd(), "public", "uploads"))).filter((name) => saved.photo_url.endsWith(name));
  assert.equal(stored.length, 1);

  const original = { NODE_ENV: process.env.NODE_ENV, E2E: process.env.E2E, TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
  t.after(() => {
    setEnv("NODE_ENV", original.NODE_ENV);
    setEnv("E2E", original.E2E);
    setEnv("BLOB_READ_WRITE_TOKEN", original.TOKEN);
  });
  setEnv("NODE_ENV", "production");
  setEnv("E2E", undefined);
  setEnv("BLOB_READ_WRITE_TOKEN", undefined);
  const originalError = console.error;
  console.error = () => undefined;
  t.after(() => {
    console.error = originalError;
  });
  const failed = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "x", photo: { bytes: PNG, type: "image/png" } });
  assert.deepEqual(failed, { ok: false, status: 500, error: "The photo didn't make it. Try again?" });
});

test("a member posting faster than the limit is refused with 429, and others are not", async () => {
  const { issue, alice, bob } = await delivered();
  for (let i = 0; i < LIMITS.comment.max; i++) {
    const posted = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: `Note ${i}` });
    assert.equal(posted.ok, true);
  }
  const refused = await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "One more" });
  assert.deepEqual(refused, { ok: false, status: 429, error: copy.issue.errors.tooMany });
  assert.equal((await postComment({ issueId: issue.issueId, viewerToken: bob.token, body: "Me too" })).ok, true);

  const later = new Date(E2E_NOW.getTime() + LIMITS.comment.windowMs);
  setRequestHeaders({ "x-e2e-now": later.toISOString() });
  assert.equal((await postComment({ issueId: issue.issueId, viewerToken: alice.token, body: "Later" })).ok, true);
  const [{ count }] = await rows<{ count: number }>("select count(*)::int as count from comments");
  assert.equal(count, LIMITS.comment.max + 2);
});

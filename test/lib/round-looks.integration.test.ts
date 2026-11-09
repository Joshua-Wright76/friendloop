/*
 * A round's own looks: a cover on a named round (its page and its email) and the
 * scrapbook layer, stickers people stick in an answer's margins once the round has
 * gone out. Each is nothing at all when nobody chose one.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { renameIssue } from "../../src/lib/identity.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { moveScrapSticker, peelScrapSticker, stickOnAnswer } from "../../src/lib/scrapbook.ts";
import { loopArchive, replyLinkExport } from "../../src/lib/data-export.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { COVER_TINTS, SCRAPBOOK_PER_ROUND } from "../../src/lib/looks.ts";
import { LIMITS, limitKey } from "../../src/lib/rate-limit-policy.ts";
import {
  AFTER_FIRST_SLOT,
  DELIVERY_DAY,
  E2E_NOW,
  addMember,
  resetDatabase,
  rows,
  seedDeliveredIssue,
  seedLoop,
  seedOpenIssue,
  seedReplies,
  setupDatabase,
} from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

async function collect(chunks: AsyncGenerator<string>) {
  let out = "";
  for await (const chunk of chunks) out += chunk;
  return JSON.parse(out);
}

const SPOT = { side: "left", offset: 40, tilt: 8 } as const;

async function deliveredLoop() {
  const loop = await seedLoop();
  await rows("update groups set share_enabled = true where id = $1", [loop.groupId]);
  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    shareToken: "scrap-share",
    answers: [
      { email: "alice@friendloop.test", body: "Alice found a goose." },
      { email: "bob@friendloop.test", body: "Bob found a duck." },
    ],
  });
  const [owner, alice, bob] = loop.members;
  const replyOf = async (membershipId: string) =>
    (await rows<{ id: string }>("select id from replies where issue_id = $1 and membership_id = $2", [issue.issueId, membershipId]))[0].id;
  return { loop, issue, owner, alice, bob, aliceReply: await replyOf(alice.id), bobReply: await replyOf(bob.id) };
}

/* ------------------------------ round covers ----------------------------- */

test("a cover is saved with a round's name, refused when it isn't ours, and goes when the name does", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const cover = async () =>
    (await rows<{ cover_sticker: string | null; cover_tint: string | null }>("select cover_sticker, cover_tint from issues where id = $1", [issue.issueId]))[0];

  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "Camping weekend", { sticker: "mushroom", tint: "moss" }), { ok: true, name: "Camping weekend" });
  assert.deepEqual(await cover(), { cover_sticker: "mushroom", cover_tint: "moss" });

  // A key that isn't ours changes nothing, the name included.
  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "Hijacked", { sticker: "<svg>", tint: "moss" }), { ok: false });
  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "Hijacked", { sticker: "frog", tint: "teal" }), { ok: false });
  assert.equal((await rows<{ name: string }>("select name from issues where id = $1", [issue.issueId]))[0].name, "Camping weekend");
  assert.deepEqual(await cover(), { cover_sticker: "mushroom", cover_tint: "moss" });

  // Renaming without the cover's fields leaves the cover be; "No cover" takes it off.
  await renameIssue(loop.groupId, issue.issueId, "Camping trip");
  assert.deepEqual(await cover(), { cover_sticker: "mushroom", cover_tint: "moss" });
  await renameIssue(loop.groupId, issue.issueId, "Camping trip", { sticker: "", tint: "moss" });
  assert.deepEqual(await cover(), { cover_sticker: null, cover_tint: null });

  // Clearing the name clears the cover with it.
  await renameIssue(loop.groupId, issue.issueId, "Camping trip", { sticker: "frog", tint: "sky" });
  assert.deepEqual(await renameIssue(loop.groupId, issue.issueId, "  ", { sticker: "frog", tint: "sky" }), { ok: true, name: null });
  assert.deepEqual(await cover(), { cover_sticker: null, cover_tint: null });
});

test("a covered round's email opens with its cover; the archive lists it; a plain round's email has none", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: issue.issueId, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "The cat." }], submittedAt: AFTER_FIRST_SLOT });
  await renameIssue(loop.groupId, issue.issueId, "Camping weekend", { sticker: "mushroom", tint: "plum" });

  await sweep({ at: DELIVERY_DAY });
  const mails = await rows<{ html: string }>("select html from outbox where kind = 'delivery' and issue_id = $1", [issue.issueId]);
  assert.ok(mails.length > 0);
  for (const mail of mails) {
    assert.match(mail.html, new RegExp(`bgcolor="${COVER_TINTS.plum.tint}"`));
    assert.match(mail.html, /\/stickers\/png\/mushroom\.png" alt="" width="72"/);
  }

  const archive = await collect((await loopArchive(loop.groupId, E2E_NOW))!.chunks);
  assert.deepEqual(archive.rounds[0].cover, { sticker: "mushroom", tint: "plum" });

  // The next round has no cover, and its archive entry says nothing about one.
  await resetDatabase();
  const plain = await seedLoop();
  const open = await seedOpenIssue(plain, { openedAt: AFTER_FIRST_SLOT });
  const bob = plain.members.find((member) => member.email.startsWith("bob"))!;
  await seedReplies({ issueId: open.issueId, membershipId: bob.id, answers: [{ text: "What made you laugh this week?", body: "A dog." }], submittedAt: AFTER_FIRST_SLOT });
  await sweep({ at: DELIVERY_DAY });
  const [mail] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' and issue_id = $1 limit 1", [open.issueId]);
  for (const { tint } of Object.values(COVER_TINTS)) assert.doesNotMatch(mail.html, new RegExp(`bgcolor="${tint}"`));
  const plainArchive = await collect((await loopArchive(plain.groupId, E2E_NOW))!.chunks);
  assert.equal("cover" in plainArchive.rounds[0], false);
});

/* ------------------------------- scrapbook ------------------------------- */

test("anyone in the loop sticks a sticker beside an answer, and everyone sees who did", async () => {
  const { issue, alice, bob, aliceReply } = await deliveredLoop();

  const stuck = await stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "frog", placement: { side: "right", offset: 140.4, tilt: -30 } });
  assert.ok(stuck.ok);
  assert.deepEqual({ ...stuck.sticker, id: undefined }, { id: undefined, replyId: aliceReply, sticker: "frog", side: "right", offset: 100, tilt: -16 }, "kept inside the margins");

  const asAlice = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  const answer = asAlice!.blocks[0].answers.find((one) => one.replyId === aliceReply)!;
  assert.deepEqual(answer.scrapbook, [{ id: stuck.sticker.id, sticker: "frog", side: "right", offset: 100, tilt: -16, by: "Bob", mine: false }]);
  assert.equal(asAlice!.scrapbookUsed, undefined, "Alice hasn't stuck any");
  assert.equal("scrapbook" in asAlice!.blocks[0].answers.find((one) => one.replyId !== aliceReply)!, false, "an answer without any reads as before");

  const asBob = await loadIssue({ issueId: issue.issueId, viewerMembershipId: bob.id });
  assert.equal(asBob!.blocks[0].answers.find((one) => one.replyId === aliceReply)!.scrapbook![0].mine, true);
  assert.equal(asBob!.scrapbookUsed, 1);

  // A share link shows the scrapbook too, belonging to nobody reading.
  const shared = await loadIssue({ shareToken: "scrap-share" });
  assert.equal(shared!.blocks[0].answers.find((one) => one.replyId === aliceReply)!.scrapbook![0].mine, false);
  assert.equal(shared!.scrapbookUsed, undefined);

  // A row that isn't ours never reaches the page.
  await rows("insert into issue_stickers (issue_id, reply_id, membership_id, sticker, side) values ($1, $2, $3, '../x', 'left'), ($1, $2, $3, 'frog', 'middle')", [issue.issueId, aliceReply, alice.id]);
  const again = await loadIssue({ issueId: issue.issueId, viewerMembershipId: alice.id });
  assert.equal(again!.blocks[0].answers.find((one) => one.replyId === aliceReply)!.scrapbook!.length, 1);
});

test("stickers are refused on an open round, off the round, on what you can't read, and when they aren't ours", async () => {
  const { loop, issue, owner, alice, bob, aliceReply } = await deliveredLoop();
  const stick = (input: Partial<Parameters<typeof stickOnAnswer>[0]>) =>
    stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "frog", placement: SPOT, ...input });

  assert.deepEqual(await stick({ sticker: "../../etc" }), { ok: false, reason: "sticker" });
  assert.deepEqual(await stick({ placement: { side: "middle", offset: 1, tilt: 0 } }), { ok: false, reason: "placement" });

  const open = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await seedReplies({ issueId: open.issueId, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "Not yet out." }], submittedAt: AFTER_FIRST_SLOT });
  const [openReply] = await rows<{ id: string }>("select id from replies where issue_id = $1", [open.issueId]);
  assert.deepEqual(await stick({ issueId: open.issueId, replyId: openReply.id }), { ok: false, reason: "round" }, "not before it goes out");
  assert.deepEqual(await stick({ replyId: openReply.id }), { ok: false, reason: "answer" }, "an answer from another round");

  // Someone from another loop, or removed from this one, isn't in the round.
  const other = await seedLoop({ name: "Other", owner: { email: "else@friendloop.test", name: "Else" }, members: [] });
  assert.deepEqual(await stick({ membershipId: other.members[0].id }), { ok: false, reason: "round" });
  await rows("update memberships set revoked_at = now() where id = $1", [bob.id]);
  assert.deepEqual(await stick({}), { ok: false, reason: "round" });
  await rows("update memberships set revoked_at = null where id = $1", [bob.id]);

  // An owners-only answer takes stickers from the owner and admins only.
  await rows("update issue_questions set admin_only = true where issue_id = $1", [issue.issueId]);
  assert.deepEqual(await stick({}), { ok: false, reason: "answer" });
  assert.ok((await stick({ membershipId: owner.id })).ok);

  // Readers stick like anyone else in the loop.
  await rows("update issue_questions set admin_only = false where issue_id = $1", [issue.issueId]);
  const reader = await addMember(loop, { email: "wren@friendloop.test", name: "Wren", participation: "reader" });
  assert.ok((await stick({ membershipId: reader.id })).ok);
});

test("three each per round, across the round, even when tapped all at once", async () => {
  const { issue, owner, alice, bob, aliceReply, bobReply } = await deliveredLoop();
  const stick = (replyId: string, membershipId = alice.id) =>
    stickOnAnswer({ issueId: issue.issueId, replyId, membershipId, sticker: "star", placement: SPOT });

  assert.ok((await stick(aliceReply)).ok);
  assert.ok((await stick(bobReply)).ok);
  assert.ok((await stick(bobReply)).ok);
  assert.deepEqual(await stick(aliceReply), { ok: false, reason: "limit" });
  assert.ok((await stick(aliceReply, bob.id)).ok, "the limit is each person's own");

  // Five at once from someone with none: three land, two are turned away.
  const results = await Promise.all(Array.from({ length: 5 }, () => stick(aliceReply, owner.id)));
  assert.equal(results.filter((result) => result.ok).length, SCRAPBOOK_PER_ROUND);
  assert.deepEqual(results.filter((result) => !result.ok), [{ ok: false, reason: "limit" }, { ok: false, reason: "limit" }]);
  const [{ count }] = await rows<{ count: number }>("select count(*)::int as count from issue_stickers where membership_id = $1", [owner.id]);
  assert.equal(count, SCRAPBOOK_PER_ROUND);
});

test("you move and peel your own; the owner and admins peel anyone's", async () => {
  const { issue, owner, alice, bob, aliceReply } = await deliveredLoop();
  const stuck = await stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "duck", placement: SPOT });
  assert.ok(stuck.ok);
  const id = stuck.sticker.id;

  const moved = await moveScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: bob.id, placement: { side: "right", offset: 70, tilt: 3 } });
  assert.ok(moved.ok);
  assert.deepEqual([moved.sticker.side, moved.sticker.offset, moved.sticker.tilt], ["right", 70, 3]);
  assert.deepEqual(await moveScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: bob.id, placement: null }), { ok: false, reason: "placement" });
  assert.deepEqual(await moveScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: alice.id, placement: SPOT }), { ok: false, reason: "gone" }, "not someone else's");
  assert.deepEqual(await moveScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: owner.id, placement: SPOT }), { ok: false, reason: "gone" }, "the owner peels, but doesn't rearrange");

  assert.deepEqual(await peelScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: alice.id }), { ok: false, reason: "gone" });
  assert.ok((await peelScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: bob.id })).ok);
  assert.deepEqual(await peelScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: bob.id }), { ok: false, reason: "gone" });

  const again = await stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "duck", placement: SPOT });
  assert.ok(again.ok);
  assert.ok((await peelScrapSticker({ issueId: issue.issueId, stickerId: again.sticker.id, membershipId: owner.id })).ok, "the owner moderates");

  // Moving and peeling ask the same of the round as sticking.
  const outsider = await seedLoop({ name: "Other", owner: { email: "else@friendloop.test", name: "Else" }, members: [] });
  assert.deepEqual(await moveScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: outsider.members[0].id, placement: SPOT }), { ok: false, reason: "round" });
  assert.deepEqual(await peelScrapSticker({ issueId: issue.issueId, stickerId: id, membershipId: outsider.members[0].id }), { ok: false, reason: "round" });
});

test("a flood of sticking, moving and peeling is slowed down", async () => {
  const { issue, bob, aliceReply } = await deliveredLoop();
  await rows(
    "insert into rate_limits (key, window_start, count, expires_at) values ($1, to_timestamp(floor(extract(epoch from now()) * 1000 / $2) * $2 / 1000), $3, now() + interval '1 hour')",
    [limitKey.scrapbook(bob.id), LIMITS.scrapbook.windowMs, LIMITS.scrapbook.max],
  );
  setRequestHeaders({});
  assert.deepEqual(await stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "frog", placement: SPOT }), { ok: false, reason: "busy" });
  assert.deepEqual(await moveScrapSticker({ issueId: issue.issueId, stickerId: aliceReply, membershipId: bob.id, placement: SPOT }), { ok: false, reason: "busy" });
  assert.deepEqual(await peelScrapSticker({ issueId: issue.issueId, stickerId: aliceReply, membershipId: bob.id }), { ok: false, reason: "busy" });
});

test("your scrapbook stickers are in your export, and the loop's archive lists them by answer", async () => {
  const { loop, issue, alice, bob, aliceReply } = await deliveredLoop();
  await stickOnAnswer({ issueId: issue.issueId, replyId: aliceReply, membershipId: bob.id, sticker: "heart", placement: SPOT });

  const [mine] = (await collect((await replyLinkExport(bob.token, E2E_NOW))!.chunks)).loops;
  assert.equal(mine.scrapbook.length, 1);
  assert.deepEqual({ ...mine.scrapbook[0], createdAt: undefined }, { round: issue.number, question: "What made you laugh this week?", answerBy: "Alice", sticker: "heart", side: "left", offset: 40, createdAt: undefined });
  const [hers] = (await collect((await replyLinkExport(alice.token, E2E_NOW))!.chunks)).loops;
  assert.equal("scrapbook" in hers, false, "nothing stuck, nothing listed");

  const archive = await collect((await loopArchive(loop.groupId, E2E_NOW))!.chunks);
  const answers = archive.rounds[0].questions[0].answers;
  assert.deepEqual(answers.find((answer: { by: string }) => answer.by === "Alice").scrapbook, [{ by: "Bob", sticker: "heart" }]);
  assert.equal("scrapbook" in answers.find((answer: { by: string }) => answer.by === "Bob"), false);
});

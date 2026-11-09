import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { issueGroupId, loadIssue, nextRoundFor } from "../../src/lib/issue-view.ts";
import { saveDraftFor, saveMusicFor, saveSectionMusicFor, saveSectionPhotoFor, saveSectionTextFor, saveWallPhotoFor } from "../../src/lib/reply.ts";
import { resetDatabase, rows, seedDeliveredIssue, seedLoop, seedOpenIssue, setupDatabase } from "../support/app.ts";
import type { SeededLoop } from "../../e2e/support/seed.ts";
import { DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { makePng } from "../../e2e/support/audio.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy } from "@/lib/copy";

/*
 * The round's page reads one list (docs/questions-unify-design.md). Items copied
 * from a section keep a section's look under `sections`, now with reactions and
 * comments like any answer; everything else is a block, where a photo wall or a
 * music pick says so with `format` and carries its photos or its card.
 */

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": DELIVERY_DAY.toISOString() });
});

const MUSIC = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";
type Kind = "standard" | "photo_wall" | "music";
const member = (loop: SeededLoop, prefix: string) => loop.members.find((candidate) => candidate.email.startsWith(prefix))!;

/**
 * A delivered round holding a section, written the way the release before the
 * switch wrote it: to the legacy tables, copied by the mirror triggers.
 */
async function deliveredSectionLoop(input: { kind: Kind; adminOnly?: boolean; title?: string; shareToken?: string }) {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [], shareToken: input.shareToken });
  const title = input.title ?? "The potluck corner";
  const [section] = await rows<{ id: string }>(
    `insert into sections (group_id, kind, title, emoji, description, admin_only, position)
     values ($1, $2, $3, '🍲', 'Bring a story about food.', $4, 0) returning id`,
    [loop.groupId, input.kind, title, input.adminOnly ?? false],
  );
  const [snapshot] = await rows<{ id: string }>(
    `insert into issue_sections (issue_id, section_id, kind, title, emoji, description, admin_only, position)
     values ($1, $2, $3, $4, '🍲', 'Bring a story about food.', $5, 0) returning id`,
    [delivered.issueId, section.id, input.kind, title, input.adminOnly ?? false],
  );
  return { loop, groupId: loop.groupId, ownerToken: loop.ownerToken, section: snapshot.id, ...delivered };
}

/** A new-format item in a delivered round, as the unified code snapshots it. */
async function deliveredItem(input: { format: "photo_wall" | "music" | "written"; adminOnly?: boolean; emoji?: string | null; description?: string | null }) {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [] });
  const [item] = await rows<{ id: string }>(
    `insert into issue_questions (issue_id, text, position, format, emoji, description, admin_only)
     values ($1, 'Weekend things', 10, $2, $3, $4, $5) returning id`,
    [delivered.issueId, input.format, input.emoji ?? null, input.description ?? null, input.adminOnly ?? false],
  );
  return { loop, groupId: loop.groupId, item: item.id, ...delivered };
}

/** A reply link only writes to an open round: open it for the writing, then send it again. */
async function writeWhileOpen(issueId: string, write: () => Promise<unknown>) {
  await rows("update issues set status = 'open' where id = $1", [issueId]);
  await write();
  await rows("update issues set status = 'delivered' where id = $1", [issueId]);
}

test("a section from before reads as it always did, crediting the author and their photo", async () => {
  const setup = await deliveredSectionLoop({ kind: "standard" });
  const alice = member(setup.loop, "alice");
  const [snapshot] = await rows<{ from_section: boolean }>("select from_section from issue_questions where id = $1", [setup.section]);
  assert.equal(snapshot.from_section, true, "copied by the mirror trigger");

  // An old sheet's text and photo, landing on the copy.
  await writeWhileOpen(setup.issueId, async () => {
    await saveSectionTextFor({ token: alice.token, issueSectionId: setup.section, body: "Banana bread." });
    await saveSectionPhotoFor({ token: alice.token, issueSectionId: setup.section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "", position: 0 });
  });

  const view = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id });
  assert.equal(view!.sections.length, 1);
  assert.deepEqual(view!.blocks.map((block) => block.question), ["What made you laugh this week?", "What are you looking forward to?"]);
  const block = view!.sections[0];
  assert.equal(`${block.kind}:${block.title}:${block.emoji}`, "standard:The potluck corner:🍲");
  assert.equal(block.description, "Bring a story about food.");
  assert.equal(block.replies.length, 1);
  const reply = block.replies[0];
  assert.equal(reply.isYou, true);
  assert.equal(reply.body, "Banana bread.");
  assert.equal(reply.media.length, 1, "the answer's one photo reads as the section's photo");
  assert.equal(reply.media[0].caption, null);
});

test("former section answers take reactions and comments like any answer", async () => {
  const setup = await deliveredSectionLoop({ kind: "photo_wall" });
  const alice = member(setup.loop, "alice");
  const bob = member(setup.loop, "bob");
  await writeWhileOpen(setup.issueId, async () => {
    await saveSectionPhotoFor({ token: alice.token, issueSectionId: setup.section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "The table", position: 0 });
    await saveSectionPhotoFor({ token: alice.token, issueSectionId: setup.section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "The leftovers", position: 1 });
  });
  const [reply] = await rows<{ id: string }>("select id from replies where issue_question_id = $1", [setup.section]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '🎉')", [reply.id, bob.id]);
  await rows("insert into comments (issue_id, membership_id, body, reply_id) values ($1, $2, 'Looks great', $3)", [setup.issueId, bob.id, reply.id]);

  const view = await loadIssue({ issueId: setup.issueId, viewerMembershipId: bob.id });
  const answer = view!.sections[0].replies[0];
  assert.deepEqual(answer.media.map((item) => item.caption), ["The table", "The leftovers"]);
  assert.deepEqual(answer.reactions.find((item) => item.emoji === "🎉"), { emoji: "🎉", count: 1, mine: true });
  assert.equal(answer.comments.length, 1);

  // A share link shows the reactions but never the comments.
  await rows("update issues set share_token = 'wall-share' where id = $1", [setup.issueId]);
  await rows("update groups set share_enabled = true where id = $1", [setup.groupId]);
  const shared = await loadIssue({ shareToken: "wall-share" });
  assert.equal(shared!.sections[0].replies[0].comments.length, 0);
  assert.equal(shared!.sections[0].replies[0].reactions.find((item) => item.emoji === "🎉")?.count, 1);
});

test("music answers from before carry their card; other readers stay strangers", async () => {
  const setup = await deliveredSectionLoop({ kind: "music" });
  const alice = member(setup.loop, "alice");

  await writeWhileOpen(setup.issueId, async () => {
    await saveSectionMusicFor({ token: alice.token, issueSectionId: setup.section, url: MUSIC, caption: "Road trip" });
  });

  // The metadata cache is warm, so no provider is reached.
  await rows(
    "insert into music_links (url, provider, title, artwork_url, fetched_at) values ($1, 'spotify', 'Road Trip Record', null, $2)",
    [MUSIC, new Date().toISOString()],
  );

  const stranger = await loadIssue({ issueId: setup.issueId });
  const reply = stranger!.sections[0].replies[0];
  assert.equal(reply.isYou, false);
  assert.equal(reply.body, "Road trip");
  assert.equal(reply.linkTitle, "Road Trip Record");
  assert.equal(reply.linkProvider, "spotify");

  const you = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id });
  assert.equal(you!.sections[0].replies[0].isYou, true);
});

test("a new photo wall is a block with its format, its words and each person's photos", async () => {
  const setup = await deliveredItem({ format: "photo_wall", emoji: "📸", description: "The best of the weekend." });
  const alice = member(setup.loop, "alice");
  await writeWhileOpen(setup.issueId, async () => {
    await saveWallPhotoFor({ token: alice.token, issueQuestionId: setup.item, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "Lake", position: 0 });
  });

  const view = await loadIssue({ issueId: setup.issueId });
  assert.deepEqual(view!.sections, []);
  const block = view!.blocks.find((candidate) => candidate.questionId === setup.item)!;
  assert.equal(`${block.format}:${block.emoji}:${block.description}`, "photo_wall:📸:The best of the weekend.");
  assert.equal(block.poll, null);
  assert.deepEqual(block.answers[0].media, [{ url: block.answers[0].media![0].url, caption: "Lake" }]);
  assert.equal(block.answers[0].link, undefined);

  // Questions read exactly as they always have: no format, no extras.
  const question = view!.blocks[0];
  assert.equal("format" in question || "emoji" in question || "description" in question, false);
});

test("a new music pick is a block whose answers carry their card", async () => {
  const setup = await deliveredItem({ format: "music" });
  const alice = member(setup.loop, "alice");
  const bob = member(setup.loop, "bob");
  await writeWhileOpen(setup.issueId, async () => {
    await saveMusicFor({ token: alice.token, issueQuestionId: setup.item, url: MUSIC, caption: "For the drive" });
    // A caption without a link is still an answer, with no card.
    await saveMusicFor({ token: bob.token, issueQuestionId: setup.item, url: "", caption: "Can't choose" });
  });
  await rows(
    "insert into music_links (url, provider, title, artwork_url, tracks, track_count, fetched_at) values ($1, 'spotify', 'Drive', 'https://img.example/d.png', '[]', 1, $2)",
    [MUSIC, new Date().toISOString()],
  );

  const view = await loadIssue({ issueId: setup.issueId });
  const block = view!.blocks.find((candidate) => candidate.questionId === setup.item)!;
  assert.equal(block.format, "music");
  assert.equal("emoji" in block, false);
  const [first, second] = block.answers;
  assert.deepEqual(first.link, { url: MUSIC, provider: "spotify", title: "Drive", artworkUrl: "https://img.example/d.png", tracks: [], trackCount: 1 });
  assert.equal(first.body, "For the drive");
  assert.equal(first.media, undefined);
  assert.equal(second.link, undefined);
  assert.equal(second.body, "Can't choose");
  assert.equal(view!.answerCount, 2);
});

test("a music card with nothing cached yet falls back to the link's own name", async (t) => {
  const setup = await deliveredItem({ format: "music" });
  await writeWhileOpen(setup.issueId, async () => {
    await saveMusicFor({ token: member(setup.loop, "alice").token, issueQuestionId: setup.item, url: MUSIC, caption: "" });
  });
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = (async () => { throw new Error("offline"); }) as typeof fetch;
  await rows("delete from music_links");
  const block = (await loadIssue({ issueId: setup.issueId }))!.blocks.find((candidate) => candidate.questionId === setup.item)!;
  assert.equal(block.answers[0].link?.title, "4uLU6hMCjMI75M1A2tKUQC");
});

test("owners-only items show to admins and hide from everyone else", async () => {
  const setup = await deliveredSectionLoop({ kind: "standard", adminOnly: true, title: "Committee notes" });
  const alice = member(setup.loop, "alice");

  const memberView = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id, viewerIsAdmin: false });
  assert.equal(memberView!.sections.length, 0);

  const ownerView = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id, viewerIsAdmin: true });
  assert.equal(ownerView!.sections.length, 1);
  assert.equal(ownerView!.sections[0].replies.length, 0);

  // A new owners-only item, answered by the owner: members neither see it nor count it.
  const item = await deliveredItem({ format: "written", adminOnly: true });
  await writeWhileOpen(item.issueId, async () => {
    assert.ok((await saveDraftFor({ token: item.loop.ownerToken, issueQuestionId: item.item, body: "Budget is fine." })).ok);
  });
  const hidden = await loadIssue({ issueId: item.issueId, viewerMembershipId: member(item.loop, "alice").id, viewerIsAdmin: false });
  assert.equal(hidden!.blocks.some((block) => block.questionId === item.item), false);
  assert.equal(hidden!.answerCount, 0);
  const shown = await loadIssue({ issueId: item.issueId, viewerIsAdmin: true });
  assert.equal(shown!.blocks.find((block) => block.questionId === item.item)!.answers[0].body, "Budget is fine.");
});

test("before it goes out, each person sees only their own answers", async () => {
  const setup = await deliveredItem({ format: "photo_wall" });
  const alice = member(setup.loop, "alice");
  const bob = member(setup.loop, "bob");
  await rows("update issues set status = 'open', delivered_at = null where id = $1", [setup.issueId]);
  for (const person of [alice, bob]) {
    assert.ok((await saveWallPhotoFor({ token: person.token, issueQuestionId: setup.item, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: person.email, position: 0 })).ok);
  }

  const asAlice = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id });
  const wall = asAlice!.blocks.find((block) => block.questionId === setup.item)!;
  assert.deepEqual(wall.answers.map((answer) => answer.authorId), [alice.id]);
  assert.equal(wall.answers[0].author, copy.issue.you);
  const asStranger = await loadIssue({ issueId: setup.issueId });
  assert.equal(asStranger!.answerCount, 0);
});

test("issues and share links without visible sections read plainly", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [] });
  const view = await loadIssue({ issueId: delivered.issueId });
  assert.deepEqual(view!.sections, []);

  const hidden = await deliveredSectionLoop({ kind: "standard", adminOnly: true, title: "Secret", shareToken: "share-token" });
  await rows("update groups set share_enabled = true where id = $1", [hidden.groupId]);
  const shared = await loadIssue({ shareToken: "share-token" });
  assert.equal(shared!.issue.id, hidden.issueId);
  assert.equal(shared!.sections.length, 0);
});

test("an issue's loop is found without loading the issue, and a stranger id finds none", async () => {
  const setup = await deliveredSectionLoop({ kind: "standard" });
  assert.equal(await issueGroupId(setup.issueId), setup.groupId);
  assert.equal(await issueGroupId("00000000-0000-4000-8000-000000000000"), null);
  assert.equal(await issueGroupId(""), null);
});

test("a sign-off can promise the open round's delivery, and nothing while the loop is paused", async () => {
  const loop = await seedLoop();
  assert.equal(await nextRoundFor(loop.groupId), null, "no round open yet");
  const open = await seedOpenIssue(loop, { openedAt: DELIVERY_DAY });
  assert.deepEqual(await nextRoundFor(loop.groupId), { number: open.number, deliversAt: open.deliversAt });
  await rows("update groups set paused_at = now() where id = $1", [loop.groupId]);
  assert.equal(await nextRoundFor(loop.groupId), null);
});

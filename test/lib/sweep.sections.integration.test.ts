import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { sweep } from "../../src/lib/sweep.ts";
import { addSection as addItemSection } from "../support/items.ts";
import { latestOutbox, outboxCount, resetDatabase, rows, seedLoop, seedReplies, setupDatabase } from "../support/app.ts";
import type { SeededLoop } from "../../e2e/support/seed.ts";
import { removeWallPhotoFor, saveDraftFor, saveMusicFor, saveWallPhotoFor } from "../../src/lib/reply.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy } from "@/lib/copy";

/*
 * Sections are items asked every round (docs/questions-unify-design.md): a round
 * opens with them after the questions, and the delivery email carries their
 * answers. Photo walls and music picks keep their own blocks in the email; a
 * written one reads like any other question.
 */

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

type Kind = "standard" | "photo_wall" | "music";
const AFTER_DELIVERY = new Date(DELIVERY_DAY.getTime() + 60000);

async function addSection(loop: SeededLoop, input: { kind?: Kind; title?: string; adminOnly?: boolean } = {}) {
  const result = await addItemSection({
    groupId: loop.groupId,
    kind: input.kind ?? "standard",
    title: input.title ?? "The potluck corner",
    emoji: "🍲",
    adminOnly: input.adminOnly ?? false,
  });
  assert.deepEqual(result, { ok: true });
}

async function sectionLoop(input: { kind?: Kind } = {}) {
  const loop = await seedLoop();
  await addSection(loop, input);
  return loop;
}

async function snapshotOf(title: string): Promise<string> {
  const [row] = await rows<{ id: string }>("select id from issue_questions where text = $1", [title]);
  return row.id;
}

const member = (loop: SeededLoop, prefix: string) => loop.members.find((candidate) => candidate.email.startsWith(prefix))!;

function makeBytes() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(56, 0);
  return new Uint8Array(Buffer.concat([header, body]));
}

test("an open round asks its questions, then every section in order", async () => {
  const loop = await sectionLoop();
  await addSection(loop, { kind: "music", title: "Music picks" });

  await sweep({ at: AFTER_FIRST_SLOT });
  const snapshots = await rows<{ text: string; format: string }>(
    "select q.text, q.format from issue_questions q inner join issues i on i.id = q.issue_id where i.group_id = $1 order by q.position asc",
    [loop.groupId],
  );
  assert.deepEqual(snapshots.map((row) => `${row.text}:${row.format}`), [
    "What made you laugh this week?:written",
    "What are you looking forward to?:written",
    "The potluck corner:written",
    "Music picks:music",
  ]);
});

test("a section a release before the switch wrote still reaches the next round", async () => {
  const loop = await seedLoop();
  // Written to the legacy table: the mirror trigger copies it into the pool.
  await rows("insert into sections (group_id, kind, title, position) values ($1, 'photo_wall', 'Old wall', 0)", [loop.groupId]);
  await sweep({ at: AFTER_FIRST_SLOT });
  const [snapshot] = await rows<{ format: string; from_section: boolean }>("select format, from_section from issue_questions where text = 'Old wall'");
  assert.deepEqual(snapshot, { format: "photo_wall", from_section: false });
});

test("a written section's answer delivers the round, and the email carries it", async () => {
  const loop = await sectionLoop();
  await sweep({ at: AFTER_FIRST_SLOT });

  assert.equal((await saveDraftFor({ token: member(loop, "alice").token, issueQuestionId: await snapshotOf("The potluck corner"), body: "Banana bread." })).ok, true);

  const delivered = await sweep({ at: AFTER_DELIVERY });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("The potluck corner"));
  assert.ok(email.html.includes("Banana bread."));
});

test("photo counts ride the photo wall's block in the delivery email", async () => {
  const loop = await sectionLoop({ kind: "photo_wall" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const wall = await snapshotOf("The potluck corner");
  const alice = member(loop, "alice");

  for (const [position, caption] of ["One", "Two"].entries()) {
    assert.ok((await saveWallPhotoFor({ token: alice.token, issueQuestionId: wall, bytes: makeBytes(), contentType: "image/png", caption, position })).ok);
  }

  const delivered = await sweep({ at: AFTER_DELIVERY });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("added 2 photos"));
});

test("a photo on its own is an answer; one taken off again is not", async () => {
  const loop = await sectionLoop({ kind: "photo_wall" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const wall = await snapshotOf("The potluck corner");

  assert.ok((await saveWallPhotoFor({ token: member(loop, "alice").token, issueQuestionId: wall, bytes: makeBytes(), contentType: "image/png", caption: "", position: 0 })).ok);
  const bob = member(loop, "bob");
  const added = await saveWallPhotoFor({ token: bob.token, issueQuestionId: wall, bytes: makeBytes(), contentType: "image/png", caption: "Soon", position: 0 });
  assert.ok(added.ok);
  assert.ok((await removeWallPhotoFor({ token: bob.token, issueQuestionId: wall, mediaId: added.mediaId })).ok);

  const delivered = await sweep({ at: AFTER_DELIVERY });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("added 1 photos"), "the photo alone is an answer");
  assert.ok(!email.html.includes(">Bob<") && !email.html.includes("Soon"), "a wall with nothing left on it is left out");
});

test("a music answer includes the provider link in the email", async () => {
  const loop = await sectionLoop({ kind: "music" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const music = await snapshotOf("The potluck corner");

  assert.equal(
    (await saveMusicFor({ token: member(loop, "alice").token, issueQuestionId: music, url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", caption: "" })).ok,
    true,
  );

  // What the provider told us when the pick was saved.
  const [{ link_url: linkUrl }] = await rows<{ link_url: string }>("select link_url from replies where issue_question_id = $1", [music]);
  await rows(
    "insert into music_links (url, provider, title) values ($1, 'spotify', 'Rain Song') on conflict (url) do update set title = 'Rain Song'",
    [linkUrl],
  );

  const delivered = await sweep({ at: AFTER_DELIVERY });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("https://open.spotify.com/track/"));
  assert.ok(email.html.includes("Rain Song"), "the email names the pick");

  // A music pick is an answer: the round doesn't read "0 answers from the group".
  const [issue] = await rows<{ id: string }>("select id from issues where number = 1");
  assert.equal((await loadIssue({ issueId: issue.id }))!.answerCount, 1);
});

test("a round with sections but nothing written carries over instead of going out", async () => {
  await sectionLoop();
  await sweep({ at: AFTER_FIRST_SLOT });
  const report = await sweep({ at: AFTER_DELIVERY });
  assert.equal(report.opened, 0);
  assert.equal(report.carried, 1);
  assert.equal(await outboxCount("delivery:"), 0);
});

test("a section from before keeps its quiet placeholder; a new card nobody answered isn't there", async () => {
  const loop = await sectionLoop({ kind: "photo_wall" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string }>("select id from issues where group_id = $1 order by number asc limit 1", [loop.groupId]);
  // A section the release before the switch put in this round, copied in with its look.
  const [section] = await rows<{ id: string }>("insert into sections (group_id, kind, title, position) values ($1, 'standard', 'Old corner', 1) returning id", [loop.groupId]);
  await rows("insert into issue_sections (issue_id, section_id, kind, title, position) values ($1, $2, 'standard', 'Old corner', 1)", [issue.id, section.id]);
  await seedReplies({ issueId: issue.id, membershipId: member(loop, "alice").id, answers: [{ text: "What made you laugh this week?", body: "The cat." }], submittedAt: AFTER_FIRST_SLOT });

  const delivered = await sweep({ at: AFTER_DELIVERY });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("Old corner"));
  // Only the old section says nobody added anything; the empty wall is left out of
  // the issue (it is still listed under the next round's questions).
  assert.equal(email.html.split(copy.issue.sectionEmpty).length - 1, 1, "an empty photo wall in a new round is hidden");
  assert.ok(email.html.includes("Next up") && !email.html.split("Next up")[0].includes("The potluck corner"));
});

test("an owners-only section reaches the owner's delivery email and no member's", async () => {
  const loop = await seedLoop();
  await addSection(loop, { title: "Notes for the organisers", adminOnly: true });
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await saveDraftFor({ token: loop.ownerToken, issueQuestionId: await snapshotOf("Notes for the organisers"), body: "Venue is booked." })).ok, true);

  assert.equal((await sweep({ at: AFTER_DELIVERY })).delivered, 1);
  const mail = await rows<{ to: string; html: string; text: string }>("select \"to\", html, text from outbox where kind = 'delivery'");
  const owner = mail.find((row) => row.to === "owner@friendloop.test")!;
  assert.ok(owner.html.includes("Venue is booked."));
  for (const row of mail.filter((candidate) => candidate.to !== "owner@friendloop.test")) {
    assert.ok(!row.html.includes("Venue is booked.") && !row.html.includes("Notes for the organisers"), `${row.to} must not see it`);
    assert.ok(!row.text.includes("Venue is booked."), `${row.to} must not see it in plain text either`);
  }
});

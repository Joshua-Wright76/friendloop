import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { db } from "@/db";
import { sections } from "@/db/schema";
import { sweep } from "../../src/lib/sweep.ts";
import { snapshotSectionsForIssue } from "../../src/lib/sections.ts";
import { latestOutbox, outboxCount, resetDatabase, rows, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { saveSectionMusicFor, saveSectionPhotoFor, saveSectionTextFor } from "../../src/lib/sections.ts";
import { submitFor } from "../../src/lib/reply.ts";
import { loadIssue } from "../../src/lib/issue-view.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

async function sectionLoop(input: { kind?: "standard" | "photo_wall" | "music" } = {}) {
  const loop = await seedLoop();
  await db.insert(sections).values({
    groupId: loop.groupId,
    kind: input.kind ?? "standard",
    title: "The potluck corner",
    emoji: "🍲",
    description: null,
    adminOnly: false,
    position: 0,
    createdAt: new Date(),
  });
  return loop;
}

test("an open round snapshots the section list in order", async () => {
  const loop = await sectionLoop();
  await db.insert(sections).values({
    groupId: loop.groupId,
    kind: "music",
    title: "Music picks",
    emoji: null,
    description: null,
    adminOnly: false,
    position: 1,
    createdAt: new Date(),
  });

  await sweep({ at: AFTER_FIRST_SLOT });
  const snapshots = await rows<{ title: string; kind: string }>(
    "select s.title, s.kind from issue_sections s inner join issues i on i.id = s.issue_id where i.group_id = $1 order by s.position asc",
    [loop.groupId],
  );
  assert.deepEqual(snapshots.map((row) => row.title), ["The potluck corner", "Music picks"]);
});

test("a section answer delivers the round, and the email carries the section", async () => {
  const loop = await sectionLoop();
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issueSection] = await rows<{ id: string }>("select id from issue_sections limit 1");
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  assert.equal((await saveSectionTextFor({ token: alice.token, issueSectionId: issueSection.id, body: "Banana bread." })).ok, true);
  await submitFor(alice.token);

  const delivered = await sweep({ at: new Date(DELIVERY_DAY.getTime() + 60000) });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("The potluck corner"));
  assert.ok(email.html.includes("Banana bread."));
});

test("photo counts ride the section blocks in the delivery email", async () => {
  const loop = await sectionLoop({ kind: "photo_wall" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issueSection] = await rows<{ id: string }>("select id from issue_sections limit 1");
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await saveSectionTextFor({ token: alice.token, issueSectionId: issueSection.id, body: "Look at these" });
  await saveSectionPhotoFor({
    token: alice.token,
    issueSectionId: issueSection.id,
    bytes: new Uint8Array(makeBytes()),
    contentType: "image/png",
    caption: "One",
    position: 0,
  });
  await saveSectionPhotoFor({
    token: alice.token,
    issueSectionId: issueSection.id,
    bytes: new Uint8Array(makeBytes()),
    contentType: "image/png",
    caption: "Two",
    position: 1,
  });
  await submitFor(alice.token);

  const delivered = await sweep({ at: new Date(DELIVERY_DAY.getTime() + 60000) });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("added 2 photos"));
  assert.ok(email.html.includes("Look at these"));
});

test("a music link answer includes the provider link in the email", async () => {
  const loop = await sectionLoop({ kind: "music" });
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issueSection] = await rows<{ id: string }>("select id from issue_sections limit 1");
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  assert.equal(
    (await saveSectionMusicFor({ token: alice.token, issueSectionId: issueSection.id, url: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", caption: "" })).ok,
    true,
  );
  await submitFor(alice.token);

  // What the provider told us when the pick was saved.
  const [{ link_url: linkUrl }] = await rows<{ link_url: string }>("select link_url from section_replies limit 1");
  await rows(
    "insert into music_links (url, provider, title) values ($1, 'spotify', 'Rain Song') on conflict (url) do update set title = 'Rain Song'",
    [linkUrl],
  );

  const delivered = await sweep({ at: new Date(DELIVERY_DAY.getTime() + 60000) });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("https://open.spotify.com/track/"));
  assert.ok(email.html.includes("Rain Song"), "the email names the pick");

  // A section reply is an answer: the round doesn't read "0 answers from the group".
  const [issue] = await rows<{ id: string }>("select id from issues where number = 1");
  assert.equal((await loadIssue({ issueId: issue.id }))!.answerCount, 1);
});

test("a round with sections but nothing submitted still skips", async () => {
  await sectionLoop();
  await sweep({ at: AFTER_FIRST_SLOT });
  const report = await sweep({ at: new Date(DELIVERY_DAY.getTime() + 60000) });
  // The skip pauses the loop, so the slot falling due at the same moment stays shut.
  assert.equal(report.opened, 0);
  assert.equal(report.skipped, 1);
  assert.equal(await outboxCount("delivery:"), 0);
});

test("an empty section block renders as its quiet placeholder", async () => {
  const loop = await sectionLoop();
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string }>(
    "select i.id as id from issues i where i.group_id = $1 order by i.number asc limit 1",
    [loop.groupId],
  );
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await seedReplies({ issueId: issue.id, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "The cat." }], submittedAt: AFTER_FIRST_SLOT });

  const delivered = await sweep({ at: new Date(DELIVERY_DAY.getTime() + 60000) });
  assert.equal(delivered.delivered, 1);
  const email = await latestOutbox("delivery:");
  assert.ok(email.html.includes("The potluck corner"));
  assert.ok(email.html.includes("Nothing here yet."));
});

function makeBytes() {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(56, 0);
  return Buffer.concat([header, body]);
}

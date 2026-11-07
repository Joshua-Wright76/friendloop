import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db } from "@/db";
import { sections } from "@/db/schema";
import { issueGroupId, loadIssue } from "../../src/lib/issue-view.ts";
import { saveSectionMusicFor, saveSectionPhotoFor, saveSectionTextFor, snapshotSectionsForIssue } from "../../src/lib/sections.ts";
import { submitFor } from "../../src/lib/reply.ts";
import { groupOf, resetDatabase, rows, seedDeliveredIssue, seedLoop, setupDatabase } from "../support/app.ts";
import { DELIVERY_DAY } from "../../e2e/support/clock.ts";
import { makePng } from "../../e2e/support/audio.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": DELIVERY_DAY.toISOString() });
});

const MUSIC = "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC";

async function deliveredSectionLoop(input: { kind: "standard" | "photo_wall" | "music"; adminOnly?: boolean; title?: string; shareToken?: string }) {
  const loop = await seedLoop();
  const group = await groupOf(loop.groupId);
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: DELIVERY_DAY, answers: [], shareToken: input.shareToken });
  await db.insert(sections).values({
    groupId: loop.groupId,
    kind: input.kind,
    title: input.title ?? "The potluck corner",
    emoji: "🍲",
    description: "Bring a story about food.",
    adminOnly: input.adminOnly ?? false,
    position: 0,
    createdAt: new Date(),
  });
  await snapshotSectionsForIssue({ group, issueId: delivered.issueId });
  return { loop, groupId: loop.groupId, ownerToken: loop.ownerToken, ...delivered };
}

async function snapshotOf(issueId: string): Promise<string> {
  const [row] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1", [issueId]);
  return row.id;
}

test("delivered issues read their sections, crediting the author and their photos", async () => {
  const setup = await deliveredSectionLoop({ kind: "standard" });
  const alice = setup.loop.members.find((member) => member.email.startsWith("alice"))!;
  const section = await snapshotOf(setup.issueId);

  await saveSectionTextFor({ token: alice.token, issueSectionId: section, body: "Banana bread." });
  await saveSectionPhotoFor({ token: alice.token, issueSectionId: section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "", position: 0 });
  await submitFor(alice.token);

  const view = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id });
  assert.equal(view!.sections.length, 1);
  const block = view!.sections[0];
  assert.equal(block.title, "The potluck corner");
  assert.equal(block.description, "Bring a story about food.");
  assert.equal(block.replies.length, 1);
  const reply = block.replies[0];
  assert.equal(reply.isYou, true);
  assert.equal(reply.body, "Banana bread.");
  assert.equal(reply.media.length, 1);
});

test("music answers carry their card; other readers stay strangers", async () => {
  const setup = await deliveredSectionLoop({ kind: "music" });
  const alice = setup.loop.members.find((member) => member.email.startsWith("alice"))!;
  const section = await snapshotOf(setup.issueId);

  await saveSectionMusicFor({ token: alice.token, issueSectionId: section, url: MUSIC, caption: "Road trip" });
  await submitFor(alice.token);

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

test("a photo wall lays out each photo with its caption", async () => {
  const setup = await deliveredSectionLoop({ kind: "photo_wall" });
  const alice = setup.loop.members.find((member) => member.email.startsWith("alice"))!;
  const section = await snapshotOf(setup.issueId);

  await saveSectionPhotoFor({ token: alice.token, issueSectionId: section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "The table", position: 0 });
  await saveSectionPhotoFor({ token: alice.token, issueSectionId: section, bytes: new Uint8Array(makePng()), contentType: "image/png", caption: "The leftovers", position: 1 });
  await submitFor(alice.token);

  const view = await loadIssue({ issueId: setup.issueId });
  const media = view!.sections[0].replies[0].media;
  assert.deepEqual(media.map((item) => item.caption), ["The table", "The leftovers"]);
});

test("an admin-only section shows to admins and hides from everyone else", async () => {
  const setup = await deliveredSectionLoop({ kind: "standard", adminOnly: true, title: "Committee notes" });
  const alice = setup.loop.members.find((member) => member.email.startsWith("alice"))!;

  const memberView = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id, viewerIsAdmin: false });
  assert.equal(memberView!.sections.length, 0);

  const ownerView = await loadIssue({ issueId: setup.issueId, viewerMembershipId: alice.id, viewerIsAdmin: true });
  assert.equal(ownerView!.sections.length, 1);
  assert.equal(ownerView!.sections[0].replies.length, 0);
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

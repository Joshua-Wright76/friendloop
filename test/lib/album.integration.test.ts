import { test } from "node:test";
import assert from "node:assert/strict";
import { loadAlbum } from "../../src/lib/album.ts";
import { ALBUM_PAGE_SIZE, parseAlbumFilters } from "../../src/lib/album-query.ts";
import { Q1, seedAlbum, writeUpload } from "../../e2e/support/album.ts";
import { rows, seedDeliveredIssue, seedLoop, setupDatabase } from "../support/app.ts";
import { copy } from "@/lib/copy";

setupDatabase();

const none = parseAlbumFilters({});

function keysOf(view: Awaited<ReturnType<typeof loadAlbum>>): string[] {
  return view.groups.flatMap((group) => group.items.map((item) => `${item.kind}:${item.body || item.caption}`));
}

test("the album lists delivered media newest round first, in a stable order", async () => {
  const world = await seedAlbum();
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.sam.id,
    viewerIsAdmin: true,
    filters: none,
  });

  assert.equal(view.total, 8);
  assert.equal(view.shown, 8);
  assert.equal(view.hasMore, false);
  assert.deepEqual(view.groups.map((group) => group.number), [2, 1]);
  assert.equal(view.groups[0].name, "Camping weekend");
  assert.deepEqual(keysOf(view), [
    "photo:Tent at dawn",
    "photo:The lake swim",
    "voice:The lake swim",
    "photo:Marshmallows, obviously",
    "photo:The bridge at night",
    "photo:Budget receipt",
    "photo:A goose on the towpath",
    "voice:Listen to the rain",
  ]);
});

test("nothing from an open round, a draft, or an admin-only section reaches an ordinary member", async () => {
  const world = await seedAlbum();
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.alice.id,
    viewerIsAdmin: false,
    filters: none,
  });

  const all = keysOf(view).join("|");
  assert.equal(view.total, 7);
  assert.doesNotMatch(all, /Surprise party plans/);
  assert.doesNotMatch(all, /Never submitted/);
  assert.doesNotMatch(all, /Budget receipt/);
});

test("the viewer's own media says You, others by name, and links point at the answer", async () => {
  const world = await seedAlbum();
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.alice.id,
    viewerIsAdmin: false,
    filters: none,
    token: world.alice.token,
  });

  const towpath = view.groups[1].items[0];
  assert.equal(towpath.author, copy.issue.you);
  assert.equal(towpath.isYou, true);
  assert.equal(towpath.context, Q1);
  assert.equal(towpath.issueHref, `/i/${world.round1}?m=${world.alice.token}#answer-${world.aliceTowpathReply}`);
  const tent = view.groups[0].items[0];
  assert.equal(tent.author, "Bob");
  assert.equal(tent.isYou, false);
  const wall = view.groups[0].items.find((item) => item.caption === "The bridge at night")!;
  assert.match(wall.issueHref, /#section-reply-/);
});

test("people without a name fall back to the start of their address, and the filter lists everyone who shared", async () => {
  const world = await seedAlbum();
  await rows("update memberships set name = null where id = $1", [world.bob.id]);
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.sam.id,
    viewerIsAdmin: true,
    filters: none,
  });
  assert.deepEqual(view.people.map((person) => person.name), ["Alice", "bob", "Sam"]);
  assert.equal(view.groups[0].items[0].author, "bob");
});

test("filtering to one member shows only their media, across rounds", async () => {
  const world = await seedAlbum();
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.sam.id,
    viewerIsAdmin: true,
    filters: parseAlbumFilters({ member: world.bob.id }),
  });
  assert.deepEqual(keysOf(view), ["photo:Tent at dawn", "voice:Listen to the rain"]);
  // The picker still offers everyone, so you can switch person.
  assert.equal(view.people.length, 3);
});

test("search matches answer text, captions and question text, every word, any case", async () => {
  const world = await seedAlbum();
  const search = async (q: string) =>
    keysOf(
      await loadAlbum({
        groupId: world.loop.groupId,
        viewerMembershipId: world.sam.id,
        viewerIsAdmin: true,
        filters: parseAlbumFilters({ q }),
      }),
    );

  assert.deepEqual(await search("TENT"), ["photo:Tent at dawn"]);
  assert.deepEqual(await search("marshmallows"), ["photo:Marshmallows, obviously"]);
  // Section titles are context too.
  assert.deepEqual(await search("photo wall"), ["photo:Marshmallows, obviously", "photo:The bridge at night"]);
  // A question's own words find the media that answered it.
  assert.deepEqual(await search("looking forward"), ["photo:The lake swim", "voice:The lake swim", "voice:Listen to the rain"]);
  // Every word has to turn up, though not in the same field.
  assert.deepEqual(await search("lake forward"), ["photo:The lake swim", "voice:The lake swim"]);
  assert.deepEqual(await search("lake goose"), []);
  // Wildcard characters are only ever literal.
  assert.deepEqual(await search("%"), []);
  assert.deepEqual(await search("_"), []);
});

test("search and member filter combine", async () => {
  const world = await seedAlbum();
  const view = await loadAlbum({
    groupId: world.loop.groupId,
    viewerMembershipId: world.sam.id,
    viewerIsAdmin: true,
    filters: parseAlbumFilters({ q: "laugh", member: world.alice.id }),
  });
  assert.deepEqual(keysOf(view), ["photo:A goose on the towpath"]);
});

test("pages grow the result, with a running total and an honest hasMore", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const delivered = await seedDeliveredIssue(loop, { deliveredAt: new Date("2026-01-09T08:00:00Z"), answers: [] });
  const url = await writeUpload("bulk", "png");
  // One photo wall holding more photos than a page.
  await rows(`insert into issue_sections (issue_id, kind, title, position) values ($1, 'photo_wall', 'Wall', 0)`, [delivered.issueId]);
  const [section] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1", [delivered.issueId]);
  const [reply] = await rows<{ id: string }>(
    `insert into section_replies (issue_id, issue_section_id, membership_id, status, submitted_at) values ($1, $2, $3, 'submitted', now()) returning id`,
    [delivered.issueId, section.id, alice.id],
  );
  for (let index = 0; index < ALBUM_PAGE_SIZE + 6; index += 1) {
    await rows("insert into section_media (section_reply_id, url, caption, position) values ($1, $2, $3, $4)", [reply.id, url, `Photo ${index}`, index]);
  }

  const input = { groupId: loop.groupId, viewerMembershipId: alice.id, viewerIsAdmin: false };
  const first = await loadAlbum({ ...input, filters: parseAlbumFilters({}) });
  assert.equal(first.total, ALBUM_PAGE_SIZE + 6);
  assert.equal(first.shown, ALBUM_PAGE_SIZE);
  assert.equal(first.hasMore, true);

  const second = await loadAlbum({ ...input, filters: parseAlbumFilters({ pages: "2" }) });
  assert.equal(second.shown, ALBUM_PAGE_SIZE + 6);
  assert.equal(second.hasMore, false);
  // The first page is a strict prefix of the second.
  assert.deepEqual(
    first.groups[0].items.map((item) => item.key),
    second.groups[0].items.slice(0, ALBUM_PAGE_SIZE).map((item) => item.key),
  );
});

test("an empty loop has an empty album, and another loop's media never leaks in", async () => {
  const world = await seedAlbum();
  const elsewhere = await seedLoop({ name: "Other loop", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  const view = await loadAlbum({
    groupId: elsewhere.groupId,
    viewerMembershipId: elsewhere.members[0].id,
    viewerIsAdmin: true,
    filters: none,
  });
  assert.deepEqual(view, { groups: [], total: 0, shown: 0, hasMore: false, people: [] });
  assert.ok(world);
});

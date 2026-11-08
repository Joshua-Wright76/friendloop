/*
 * Migration `0023` (docs/questions-unify-design.md, PR B): copy and switch.
 *
 * Seeds every legacy shape the way PR A's release left the database (sections,
 * events and their answers only in the legacy tables, a turn-taking loop with its
 * cursor part-way round), runs the real migration file the way the deploy does,
 * and checks the copy is complete, keeps every id, and changes nothing when run
 * again. Then plays PR A's code writing the legacy tables after the migration, as
 * it does in the minutes before the new code goes live (and after a rollback),
 * and checks every write is mirrored, and that a write colliding with a row the
 * new code made is left out instead of failing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rows, setupDatabase } from "../support/app.ts";
import { runMigrationFile } from "../../e2e/support/db.ts";
import { undoUnifiedCopy } from "../../e2e/support/golden.ts";

setupDatabase();

const MIGRATION = path.join(process.cwd(), "drizzle", "0023_questions_unify.sql");
const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;

const ROTATING = id(1);
const ALL = id(2);
const SAM = id(10);
const ALICE = id(11);
const BOB = id(12);
const CLEO = id(13);
const ROT_OWNER = id(14);
const Q = (n: number) => id(20 + n); // turn-taking loop's pool, positions 0..4
const ARCHIVED_ROT = id(26);
const ALL_Q1 = id(27);
const ALL_Q2 = id(28);
const ALL_ARCHIVED = id(29);
const ROT_OPEN = id(30);
const DELIVERED = id(31);
const OPEN = id(32);
const S = { standard: id(40), wall: id(41), music: id(42), admin: id(43), archived: id(44), unticked: id(45) };
const E = { once: id(50), birthday: id(51) };
const IS = { standard: id(60), wall: id(61), music: id(62), admin: id(63), once: id(64), birthday: id(65), orphan: id(66) };
const IO = { standard: id(70), wall: id(71), birthday: id(72) };
const R = { delivered: id(80), neverSent: id(81), wall: id(82), music: id(83), birthday: id(84), open: id(85), openWall: id(86) };
const M = { deliveredStandard: id(90), wall0: id(91), wall1: id(92), openStandard: id(93), openExtra: id(94), openWall: id(95) };

async function seedLegacy(): Promise<void> {
  await rows(
    `insert into groups (id, name, display_name, timezone, questions_per_round, question_cursor, created_at) values
      ($1, 'Rotating', 'Rotating', 'Europe/Amsterdam', 2, 3, '2026-01-01T00:00:00Z'),
      ($2, 'All', 'All', 'Europe/Amsterdam', null, 0, '2026-01-01T00:00:00Z')`,
    [ROTATING, ALL],
  );
  const people: Array<[string, string, string, string]> = [
    [SAM, ALL, "sam@unify.test", "owner"],
    [ALICE, ALL, "alice@unify.test", "member"],
    [BOB, ALL, "bob@unify.test", "member"],
    [CLEO, ALL, "cleo@unify.test", "admin"],
    [ROT_OWNER, ROTATING, "rot@unify.test", "owner"],
  ];
  for (const [index, [memberId, groupId, email, access]] of people.entries()) {
    await rows(
      `insert into memberships (id, group_id, email, name, access, participation, reply_token, unsubscribe_token, invited_at, accepted_at)
       values ($1, $2, $3, $4, $5, 'contributor', $6, $7, now(), now())`,
      [memberId, groupId, email, email.split("@")[0], access, `token-${index}`, String(index).repeat(64)],
    );
  }

  // The turn-taking loop: five questions, cursor at 3; its open round started at 1 (asked Q1, Q2).
  for (let n = 0; n < 5; n += 1) {
    await rows("insert into questions (id, group_id, text, position, created_at) values ($1, $2, $3, $4, '2026-01-01T00:00:00Z')", [Q(n), ROTATING, `Q${n}`, n]);
  }
  await rows(
    "insert into questions (id, group_id, text, position, active, archived_at) values ($1, $2, 'Old', 5, false, '2026-02-01T00:00:00Z')",
    [ARCHIVED_ROT, ROTATING],
  );
  await rows(
    `insert into issues (id, group_id, number, status, slot_at, opens_at, delivers_at, question_cursor)
     values ($1, $2, 1, 'open', '2026-11-13T08:00:00Z', '2026-11-06T08:00:00Z', '2026-11-13T08:00:00Z', 1)`,
    [ROT_OPEN, ROTATING],
  );

  // The "all questions" loop, which carries every legacy shape.
  await rows(
    `insert into questions (id, group_id, text, position, active, archived_at) values
      ($1, $4, 'All one', 0, true, null), ($2, $4, 'All two', 1, true, null), ($3, $4, 'All gone', 2, false, '2026-02-01T00:00:00Z')`,
    [ALL_Q1, ALL_Q2, ALL_ARCHIVED, ALL],
  );
  await rows(
    `insert into sections (id, group_id, kind, title, emoji, description, admin_only, position, active, archived_at, created_at) values
      ($1, $7, 'standard', 'This week', '📝', 'Anything.', false, 0, true, null, '2026-01-01T00:00:00Z'),
      ($2, $7, 'photo_wall', 'Photo wall', '📸', null, false, 1, true, null, '2026-01-01T00:00:00Z'),
      ($3, $7, 'music', 'Song', '🎵', 'One song.', false, 2, true, null, '2026-01-01T00:00:00Z'),
      ($4, $7, 'standard', 'Planning', '🗂️', null, true, 3, true, null, '2026-01-01T00:00:00Z'),
      ($5, $7, 'standard', 'Archived', null, null, false, 4, false, '2026-03-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      ($6, $7, 'standard', 'Unticked', null, null, false, 5, false, null, '2026-01-01T00:00:00Z')`,
    [S.standard, S.wall, S.music, S.admin, S.archived, S.unticked, ALL],
  );
  await rows(
    `insert into events (id, group_id, kind, title, emoji, month, day, year, membership_id, created_at) values
      ($1, $3, 'once', 'Camping', '🏕️', 10, 29, 2026, null, '2026-01-01T00:00:00Z'),
      ($2, $3, 'birthday', null, '🎂', 10, 28, null, $4, '2026-01-01T00:00:00Z')`,
    [E.once, E.birthday, ALL, ALICE],
  );
  await rows(
    `insert into issues (id, group_id, number, status, slot_at, opens_at, delivers_at, delivered_at) values
      ($1, $3, 1, 'delivered', '2026-10-30T08:00:00Z', '2026-10-23T08:00:00Z', '2026-10-30T08:00:00Z', '2026-10-30T08:00:00Z'),
      ($2, $3, 2, 'open', '2026-11-06T08:00:00Z', '2026-10-30T08:00:00Z', '2026-11-06T08:00:00Z', null)`,
    [DELIVERED, OPEN, ALL],
  );
  await rows(
    `insert into issue_sections (id, issue_id, section_id, kind, title, emoji, description, admin_only, position, event_id, event_date) values
      ($1, $8, $9, 'standard', 'This week', '📝', 'Anything.', false, 0, null, null),
      ($2, $8, $10, 'photo_wall', 'Photo wall', '📸', null, false, 1, null, null),
      ($3, $8, $11, 'music', 'Song', '🎵', 'One song.', false, 2, null, null),
      ($4, $8, $12, 'standard', 'Planning', '🗂️', null, true, 3, null, null),
      ($5, $8, null, 'standard', 'Camping', '🏕️', 'A day out.', false, 4, $13, '2026-10-29'),
      ($6, $8, null, 'standard', 'Alice''s birthday', '🎂', null, false, 5, $14, '2026-10-28'),
      ($7, $8, null, 'standard', 'Gone section', null, null, false, 6, null, null)`,
    [IS.standard, IS.wall, IS.music, IS.admin, IS.once, IS.birthday, IS.orphan, DELIVERED, S.standard, S.wall, S.music, S.admin, E.once, E.birthday],
  );
  await rows(
    `insert into issue_sections (id, issue_id, section_id, kind, title, emoji, description, admin_only, position, event_id, event_date) values
      ($1, $4, $5, 'standard', 'This week', '📝', 'Anything.', false, 0, null, null),
      ($2, $4, $6, 'photo_wall', 'Photo wall', '📸', null, false, 1, null, null),
      ($3, $4, null, 'standard', 'Alice''s birthday', '🎂', null, false, 2, $7, '2027-10-28')`,
    [IO.standard, IO.wall, IO.birthday, OPEN, S.standard, S.wall, E.birthday],
  );
  const reply = (replyId: string, issueId: string, sectionId: string, member: string, extra: { body?: string; link?: string; late?: boolean; neverSent?: boolean; minute: number }) =>
    rows(
      `insert into section_replies (id, issue_id, issue_section_id, membership_id, body, link_url, link_provider, status, submitted_at,
                                    added_after_delivery, never_sent, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, $9, $10, $8, $8)`,
      [replyId, issueId, sectionId, member, extra.body ?? "", extra.link ?? null, extra.link ? "spotify" : null,
        new Date(Date.UTC(2026, 9, 24, 8, extra.minute)).toISOString(), extra.late ?? false, extra.neverSent ?? false],
    );
  await reply(R.delivered, DELIVERED, IS.standard, SAM, { body: "Quilt.", minute: 1 });
  await reply(R.neverSent, DELIVERED, IS.standard, BOB, { body: "Draft.", neverSent: true, minute: 2 });
  await reply(R.wall, DELIVERED, IS.wall, BOB, { minute: 3 });
  await reply(R.music, DELIVERED, IS.music, CLEO, { body: "Drive.", link: "https://open.spotify.com/track/x", late: true, minute: 4 });
  await reply(R.birthday, DELIVERED, IS.birthday, SAM, { body: "Happy birthday!", minute: 5 });
  await reply(R.open, OPEN, IO.standard, ALICE, { body: "This week, so far.", minute: 6 });
  await reply(R.openWall, OPEN, IO.wall, SAM, { minute: 7 });
  const media = (mediaId: string, replyId: string, url: string, caption: string | null, position: number) =>
    rows(
      "insert into section_media (id, section_reply_id, url, caption, position, created_at) values ($1, $2, $3, $4, $5, '2026-10-24T09:00:00Z')",
      [mediaId, replyId, url, caption, position],
    );
  await media(M.deliveredStandard, R.delivered, "/uploads/quilt.png", null, 0);
  await media(M.wall0, R.wall, "/uploads/lake.png", "The lake", 0);
  await media(M.wall1, R.wall, "/uploads/tent.png", "Tent", 1);
  await media(M.openStandard, R.open, "/uploads/open.png", null, 0);
  await media(M.openExtra, R.open, "/uploads/extra.png", null, 1);
  await media(M.openWall, R.openWall, "/uploads/wall.png", "Wall", 0);

  // The test schema already mirrors as it goes; take the copy out, as PR A left things.
  await undoUnifiedCopy();
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const [row] = await rows<{ n: number }>(`select count(*)::int as n from (${sql}) x`, params);
  return row.n;
}

/** Everything the migration writes, in a stable order, for before/after comparison. */
async function unifiedState() {
  return {
    questions: await rows("select * from questions order by id"),
    issueQuestions: await rows("select * from issue_questions order by id"),
    replies: await rows("select * from replies order by id"),
    media: await rows("select * from reply_media order by id"),
    groups: await rows("select id, question_cursor from groups order by id"),
    issues: await rows("select id, question_cursor from issues order by id"),
  };
}

/** PR A's selection: `count` questions from `cursor` over the active, unarchived pool in position order. */
async function selection(groupId: string, cursor: number, size: number): Promise<string[]> {
  const pool = await rows<{ id: string }>(
    "select id from questions where group_id = $1 and active and archived_at is null order by position, created_at, id",
    [groupId],
  );
  const start = ((cursor % pool.length) + pool.length) % pool.length;
  return [...pool.slice(start), ...pool.slice(0, start)].slice(0, size).map((row) => row.id);
}

test("the seed is PR A's state: nothing of the legacy tables is in the unified ones", async () => {
  await seedLegacy();
  assert.equal(await count("select 1 from issue_questions where from_section"), 0);
  assert.equal(await count("select 1 from reply_media"), 0);
  assert.equal(await count("select 1 from questions where id in (select id from sections union select id from events)"), 0);
});

test("0023 copies every section, event, round section, answer and photo, keeping their ids", async () => {
  await seedLegacy();
  await runMigrationFile(MIGRATION);

  // Counts, legacy against unified.
  assert.equal(await count("select 1 from questions where id in (select id from sections)"), await count("select 1 from sections"));
  assert.equal(await count("select 1 from questions where id in (select id from events)"), await count("select 1 from events"));
  assert.equal(await count("select 1 from issue_questions where from_section"), await count("select 1 from issue_sections"));
  assert.equal(await count("select 1 from issue_questions where from_section and id not in (select id from issue_sections)"), 0);
  assert.equal(await count("select 1 from replies where id in (select id from section_replies)"), await count("select 1 from section_replies"));
  // Every photo arrives once: as a photo-wall or kept photo with its id, or as the open round's answer photo.
  assert.equal(
    (await count("select 1 from reply_media where id in (select id from section_media)")) +
      (await count("select 1 from replies where photo_url in (select url from section_media)")),
    await count("select 1 from section_media"),
  );

  // Sections: every round, numbered after the questions, never `active`, stopped when stopped or unticked.
  const sections = await rows<Record<string, unknown>>("select * from questions where id = any($1) order by position", [Object.values(S)]);
  assert.deepEqual(sections.map((row) => [row.text, row.format, row.frequency, row.position, row.active, row.kind]), [
    ["This week", "written", "every_round", 1000, false, "written"],
    ["Photo wall", "photo_wall", "every_round", 1001, false, "written"],
    ["Song", "music", "every_round", 1002, false, "written"],
    ["Planning", "written", "every_round", 1003, false, "written"],
    ["Archived", "written", "every_round", 1004, false, "written"],
    ["Unticked", "written", "every_round", 1005, false, "written"],
  ]);
  const byId = new Map(sections.map((row) => [row.id, row]));
  assert.equal(byId.get(S.standard)!.emoji, "📝");
  assert.equal(byId.get(S.standard)!.description, "Anything.");
  assert.equal(byId.get(S.admin)!.admin_only, true);
  assert.equal(byId.get(S.standard)!.archived_at, null);
  assert.equal((byId.get(S.archived)!.archived_at as Date).toISOString(), "2026-03-01T00:00:00.000Z");
  assert.ok(byId.get(S.unticked)!.archived_at, "an unticked section arrives stopped");

  // Events: on a date, with the birthday person and an empty title.
  const [once] = await rows<Record<string, unknown>>("select * from questions where id = $1", [E.once]);
  assert.deepEqual([once.text, once.frequency, once.date_kind, once.month, once.day, once.year, once.about_membership_id, once.active],
    ["Camping", "on_date", "once", 10, 29, 2026, null, false]);
  const [birthday] = await rows<Record<string, unknown>>("select * from questions where id = $1", [E.birthday]);
  assert.deepEqual([birthday.text, birthday.date_kind, birthday.year, birthday.about_membership_id], ["", "birthday", null, ALICE]);

  // Round sections: after every question, from a section, with the date and the birthday person frozen.
  const snapshots = await rows<Record<string, unknown>>("select *, occurrence_date::text as occurrence from issue_questions where from_section order by issue_id, position");
  const snap = new Map(snapshots.map((row) => [row.id, row]));
  assert.deepEqual([snap.get(IS.standard)!.question_id, snap.get(IS.standard)!.position, snap.get(IS.standard)!.format, snap.get(IS.standard)!.issue_id],
    [S.standard, 1000, "written", DELIVERED]);
  assert.equal(snap.get(IS.wall)!.format, "photo_wall");
  assert.equal(snap.get(IS.music)!.format, "music");
  assert.equal(snap.get(IS.admin)!.admin_only, true);
  assert.deepEqual([snap.get(IS.once)!.question_id, snap.get(IS.once)!.occurrence, snap.get(IS.once)!.about_membership_id, snap.get(IS.once)!.description],
    [E.once, "2026-10-29", null, "A day out."]);
  assert.deepEqual([snap.get(IS.birthday)!.question_id, snap.get(IS.birthday)!.about_membership_id, snap.get(IS.birthday)!.text],
    [E.birthday, ALICE, "Alice's birthday"]);
  assert.equal(snap.get(IS.orphan)!.question_id, null, "a deleted section's snapshot keeps its words, without a pool item");
  assert.deepEqual([snap.get(IO.birthday)!.occurrence, snap.get(IO.birthday)!.issue_id], ["2027-10-28", OPEN]);

  // Answers: every field, the flags included.
  const answers = new Map((await rows<Record<string, unknown>>("select * from replies where id in (select id from section_replies)")).map((row) => [row.id, row]));
  assert.deepEqual([answers.get(R.delivered)!.issue_question_id, answers.get(R.delivered)!.membership_id, answers.get(R.delivered)!.body],
    [IS.standard, SAM, "Quilt."]);
  assert.equal(answers.get(R.neverSent)!.never_sent, true);
  assert.deepEqual([answers.get(R.music)!.link_url, answers.get(R.music)!.link_provider, answers.get(R.music)!.added_after_delivery],
    ["https://open.spotify.com/track/x", "spotify", true]);
  assert.equal(answers.get(R.delivered)!.photo_url, null, "a delivered round keeps its photo as a media row");
  assert.equal(answers.get(R.open)!.photo_url, "/uploads/open.png", "the open round's standard photo becomes the answer's photo");

  // Photos: ids, captions and positions kept.
  const media = new Map((await rows<Record<string, unknown>>("select * from reply_media")).map((row) => [row.id, row]));
  assert.deepEqual([...media.keys()].sort(), [M.deliveredStandard, M.wall0, M.wall1, M.openExtra, M.openWall].sort());
  assert.deepEqual([media.get(M.deliveredStandard)!.reply_id, media.get(M.deliveredStandard)!.caption], [R.delivered, null]);
  assert.deepEqual([media.get(M.wall1)!.reply_id, media.get(M.wall1)!.caption, media.get(M.wall1)!.position], [R.wall, "Tent", 1]);
  assert.deepEqual([media.get(M.openExtra)!.reply_id, media.get(M.openExtra)!.url], [R.open, "/uploads/extra.png"]);
});

test("0023 turns an all-questions loop's questions into every-round items and makes the turn-takers' order the queue", async () => {
  await seedLegacy();
  const roundBefore = await selection(ROTATING, 1, 2);
  const nextBefore = await selection(ROTATING, 3, 2);
  assert.deepEqual(roundBefore, [Q(1), Q(2)]);
  assert.deepEqual(nextBefore, [Q(3), Q(4)]);

  await runMigrationFile(MIGRATION);

  const all = await rows<{ id: string; frequency: string }>("select id, frequency from questions where id = any($1) order by position", [[ALL_Q1, ALL_Q2, ALL_ARCHIVED]]);
  assert.deepEqual(all.map((row) => [row.id, row.frequency]), [[ALL_Q1, "every_round"], [ALL_Q2, "every_round"], [ALL_ARCHIVED, "rotating"]]);
  assert.equal(await count("select 1 from questions where group_id = $1 and frequency <> 'rotating'", [ROTATING]), 0);

  // The queue starts where the cursor pointed.
  const queue = await rows<{ id: string; position: number }>(
    "select id, position from questions where group_id = $1 and active and archived_at is null order by position",
    [ROTATING],
  );
  assert.deepEqual(queue.map((row) => [row.id, row.position]), [[Q(3), 0], [Q(4), 1], [Q(0), 2], [Q(1), 3], [Q(2), 4]]);
  const [group] = await rows<{ question_cursor: number }>("select question_cursor from groups where id = $1", [ROTATING]);
  const [issue] = await rows<{ question_cursor: number }>("select question_cursor from issues where id = $1", [ROT_OPEN]);
  assert.equal(group.question_cursor, 0);
  assert.equal(issue.question_cursor, 3);
  // PR A's code, still serving, selects the same questions from the rewritten cursors.
  assert.deepEqual(await selection(ROTATING, issue.question_cursor, 2), roundBefore);
  assert.deepEqual(await selection(ROTATING, group.question_cursor, 2), nextBefore);
});

test("0023 run a second time changes nothing", async () => {
  await seedLegacy();
  await runMigrationFile(MIGRATION);
  const first = await unifiedState();
  await runMigrationFile(MIGRATION);
  assert.deepEqual(await unifiedState(), first);
});

test("after 0023, every legacy write from the code still serving is mirrored", async () => {
  await seedLegacy();
  await runMigrationFile(MIGRATION);
  const question = async (questionId: string) => (await rows<Record<string, unknown>>("select * from questions where id = $1", [questionId]))[0];

  // A section added, renamed, unticked, ticked again, removed.
  const added = id(100);
  await rows("insert into sections (id, group_id, kind, title, position) values ($1, $2, 'music', 'New tunes', 6)", [added, ALL]);
  assert.deepEqual([(await question(added)).text, (await question(added)).format, (await question(added)).frequency, (await question(added)).position, (await question(added)).active],
    ["New tunes", "music", "every_round", 1006, false]);
  await rows("update sections set title = 'Newer tunes', active = false where id = $1", [added]);
  assert.equal((await question(added)).text, "Newer tunes");
  assert.ok((await question(added)).archived_at, "unticking stops it");
  await rows("update sections set active = true where id = $1", [added]);
  assert.equal((await question(added)).archived_at, null);
  await rows("delete from sections where id = $1", [added]);
  assert.equal(await question(added), undefined);

  // An event added, moved, removed.
  const event = id(101);
  await rows("insert into events (id, group_id, kind, title, month, day, year) values ($1, $2, 'once', 'Picnic', 7, 4, 2027)", [event, ALL]);
  assert.deepEqual([(await question(event)).frequency, (await question(event)).day], ["on_date", 4]);
  await rows("update events set day = 5 where id = $1", [event]);
  assert.equal((await question(event)).day, 5);
  await rows("delete from events where id = $1", [event]);
  assert.equal(await question(event), undefined);

  // A section synced into the open round, answered, edited, given a photo and back.
  const section = id(102);
  const snapshot = id(103);
  const answer = id(104);
  const photo = id(105);
  await rows("insert into sections (id, group_id, kind, title, position) values ($1, $2, 'standard', 'Wins', 7)", [section, ALL]);
  await rows(
    "insert into issue_sections (id, issue_id, section_id, kind, title, position) values ($1, $2, $3, 'standard', 'Wins', 3)",
    [snapshot, OPEN, section],
  );
  const [copied] = await rows<Record<string, unknown>>("select * from issue_questions where id = $1", [snapshot]);
  assert.deepEqual([copied.question_id, copied.from_section, copied.position, copied.format], [section, true, 1003, "written"]);
  await rows(
    "insert into section_replies (id, issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, $4, 'First', 'submitted')",
    [answer, OPEN, snapshot, BOB],
  );
  await rows("update section_replies set body = 'Second' where id = $1", [answer]);
  const reply = async () => (await rows<Record<string, unknown>>("select * from replies where id = $1", [answer]))[0];
  assert.deepEqual([(await reply()).body, (await reply()).issue_question_id], ["Second", snapshot]);
  await rows("insert into section_media (id, section_reply_id, url) values ($1, $2, '/uploads/win.png')", [photo, answer]);
  assert.equal((await reply()).photo_url, "/uploads/win.png");
  await rows("delete from section_media where id = $1", [photo]);
  assert.equal((await reply()).photo_url, null);

  // A photo-wall photo added and removed.
  const wallPhoto = id(106);
  await rows("insert into section_media (id, section_reply_id, url, caption, position) values ($1, $2, '/uploads/w2.png', 'Two', 1)", [wallPhoto, R.openWall]);
  const [kept] = await rows<Record<string, unknown>>("select * from reply_media where id = $1", [wallPhoto]);
  assert.deepEqual([kept.reply_id, kept.caption, kept.position], [R.openWall, "Two", 1]);
  await rows("delete from section_media where id = $1", [wallPhoto]);
  assert.equal(await count("select 1 from reply_media where id = $1", [wallPhoto]), 0);

  // Deletes: an answer, then a round's section with what hangs from it.
  await rows("delete from section_replies where id = $1", [R.open]);
  assert.equal(await count("select 1 from replies where id = $1", [R.open]), 0);
  await rows("delete from issue_sections where id = $1", [snapshot]);
  assert.equal(await count("select 1 from issue_questions where id = $1", [snapshot]), 0);
  assert.equal(await count("select 1 from replies where id = $1", [answer]), 0);
});

test("a legacy round item that collides with one the new code made is still copied, unlinked, with its answers", async () => {
  await seedLegacy();
  await runMigrationFile(MIGRATION);

  // The new code put a section's item into the open round itself.
  const section = id(110);
  const mine = id(111);
  await rows("insert into sections (id, group_id, kind, title, position) values ($1, $2, 'standard', 'Notes', 8)", [section, ALL]);
  await rows("insert into issue_questions (id, issue_id, question_id, text, position, format) values ($1, $2, $3, 'Notes', 9, 'written')", [mine, OPEN, section]);

  // Then code from before the switch (a rollback) syncs the same section in under its own id.
  const theirs = id(112);
  await rows("insert into issue_sections (id, issue_id, section_id, kind, title, position) values ($1, $2, $3, 'standard', 'Notes', 4)", [theirs, OPEN, section]);
  assert.deepEqual(
    (await rows<{ id: string }>("select id from issue_questions where issue_id = $1 and question_id = $2", [OPEN, section])).map((row) => row.id),
    [mine],
  );
  // The legacy row is copied too, without its link to the pool, so nothing written under it is lost.
  const [copied] = await rows<{ question_id: string | null; from_section: boolean }>(
    "select question_id, from_section from issue_questions where id = $1",
    [theirs],
  );
  assert.deepEqual(copied, { question_id: null, from_section: true });
  const answerOnIt = id(113);
  await rows("insert into section_replies (id, issue_id, issue_section_id, membership_id, body) values ($1, $2, $3, $4, 'Hi')", [answerOnIt, OPEN, theirs, BOB]);
  await rows("insert into section_media (id, section_reply_id, url) values ($1, $2, '/uploads/kept.png')", [id(114), answerOnIt]);
  assert.equal(await count("select 1 from replies where id = $1 and issue_question_id = $2", [answerOnIt, theirs]), 1);
  // An open round's standard photo is the answer's photo.
  assert.equal(await count("select 1 from replies where id = $1 and photo_url = '/uploads/kept.png'", [answerOnIt]), 1);

  // The new code saved Bob's photo-wall answer; then an old sheet's write lands under another id.
  const newAnswer = id(115);
  await rows(
    "insert into replies (id, issue_id, issue_question_id, membership_id, body, status) values ($1, $2, $3, $4, '', 'submitted')",
    [newAnswer, OPEN, IO.wall, BOB],
  );
  await rows("insert into section_replies (id, issue_id, issue_section_id, membership_id, body) values ($1, $2, $3, $4, 'Old')", [id(116), OPEN, IO.wall, BOB]);
  assert.deepEqual(
    (await rows<{ id: string }>("select id from replies where issue_id = $1 and issue_question_id = $2 and membership_id = $3", [OPEN, IO.wall, BOB])).map((row) => row.id),
    [newAnswer],
  );

  // A dated occurrence the new code already claimed keeps its one linked card; the legacy one is copied unlinked.
  const claimed = id(117);
  await rows(
    "insert into issue_questions (id, issue_id, question_id, text, position, format, occurrence_date) values ($1, $2, $3, 'Camping', 10, 'written', '2027-10-29')",
    [claimed, OPEN, E.once],
  );
  await rows(
    "insert into issue_sections (id, issue_id, section_id, kind, title, position, event_id, event_date) values ($1, $2, null, 'standard', 'Camping', 5, $3, '2027-10-29')",
    [id(118), DELIVERED, E.once],
  );
  assert.deepEqual(
    (await rows<{ id: string }>("select id from issue_questions where question_id = $1 and occurrence_date = '2027-10-29'", [E.once])).map((row) => row.id),
    [claimed],
  );
  assert.equal(await count("select 1 from issue_questions where id = $1 and question_id is null", [id(118)]), 1);
});

test("a past round with two cards for one event (moved mid-round) keeps both, and every answer", async () => {
  await seedLegacy();
  // The old code placed the event again after its date moved inside the same round.
  const again = id(120);
  await rows(
    "insert into issue_sections (id, issue_id, section_id, kind, title, position, event_id, event_date) values ($1, $2, null, 'standard', 'Camping, moved', 9, $3, '2026-10-30')",
    [again, DELIVERED, E.once],
  );
  await rows("insert into section_replies (id, issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, $4, 'See you there', 'submitted')", [id(121), DELIVERED, again, BOB]);
  await undoUnifiedCopy();
  await runMigrationFile(MIGRATION);

  assert.equal(await count("select 1 from issue_questions where id = $1 and from_section and question_id is null", [again]), 1);
  assert.equal(await count("select 1 from replies where id = $1 and issue_question_id = $2", [id(121), again]), 1);
});

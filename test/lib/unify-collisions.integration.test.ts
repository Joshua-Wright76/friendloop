/*
 * Migration `0023` when legacy ids are already taken (the dev database's UI-preview
 * loop gave its sections the ids of its own questions).
 *
 * Every legacy table here reuses an id that a native row of its target table
 * already holds: a section and an event take questions' ids, round sections take
 * round questions' ids, a section answer takes an answer's id and a section photo a
 * wall photo's id. Copied by the mirror triggers as it is seeded, and again by the
 * real migration file from PR A's state, the result must be the same: no native row
 * changes, every legacy row gets a copy under a fresh id recorded in `unify_ids`,
 * the copies link to each other and not to the native rows, later legacy writes
 * reach only the copies, and an old sheet's writes by legacy id land on the copy.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rows, setupDatabase } from "../support/app.ts";
import { runMigrationFile } from "../../e2e/support/db.ts";
import { undoUnifiedCopy } from "../../e2e/support/golden.ts";
import { removeSectionMediaFor, saveSectionMusicFor, saveSectionTextFor, sheetFor, unifiedIdOf } from "../../src/lib/reply.ts";
import { fillOpenRound } from "../../src/lib/round-questions.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

const MIGRATION = path.join(process.cwd(), "drizzle", "0023_questions_unify.sql");
const id = (n: number) => `00000000-0000-4000-a000-${String(n).padStart(12, "0")}`;

const LOOP = id(1);
const SAM = id(2);
const BOB = id(3);
const DELIVERED = id(4);
const OPEN = id(5);
const TOKEN = "collide-token-bob";

// Native rows, and the legacy rows that reuse their ids.
const QUESTION = { laugh: id(10), ahead: id(11), cook: id(12) };
const SECTION = { standard: QUESTION.laugh, wall: QUESTION.ahead }; // sections on questions' ids
const EVENT = QUESTION.cook; // an event on a question's id
const ASK = { deliveredLaugh: id(20), deliveredAhead: id(21), openLaugh: id(22), openAhead: id(23), openCook: id(24) };
const ROUND_SECTION = { deliveredStandard: ASK.deliveredLaugh, deliveredWall: ASK.deliveredAhead, openStandard: ASK.openLaugh, openWall: ASK.openAhead };
const ANSWER = { deliveredLaugh: id(30), deliveredAhead: id(31), openLaugh: id(32) };
const SECTION_ANSWER = { deliveredStandard: ANSWER.deliveredLaugh, deliveredWall: ANSWER.deliveredAhead, openStandard: ANSWER.openLaugh };
const WALL_PHOTO = id(40); // a native wall photo on a native answer
const SECTION_PHOTO = WALL_PHOTO; // a legacy photo on the native photo's id

async function seed(): Promise<void> {
  await rows(
    "insert into groups (id, name, display_name, timezone, questions_per_round, created_at) values ($1, 'Collide', 'Collide', 'Europe/Amsterdam', null, '2026-01-01T00:00:00Z')",
    [LOOP],
  );
  await rows(
    `insert into memberships (id, group_id, email, name, access, participation, reply_token, unsubscribe_token, invited_at, accepted_at) values
      ($1, $3, 'sam@collide.test', 'Sam', 'owner', 'contributor', 'collide-token-sam', $4, now(), now()),
      ($2, $3, 'bob@collide.test', 'Bob', 'member', 'contributor', $5, $6, now(), now())`,
    [SAM, BOB, LOOP, "e".repeat(64), TOKEN, "f".repeat(64)],
  );
  await rows(
    `insert into questions (id, group_id, text, position, frequency, created_at) values
      ($1, $4, 'What made you laugh this week?', 0, 'every_round', '2026-01-01T00:00:00Z'),
      ($2, $4, 'What are you looking forward to?', 1, 'every_round', '2026-01-01T00:00:00Z'),
      ($3, $4, 'What did you cook?', 2, 'every_round', '2026-01-01T00:00:00Z')`,
    [QUESTION.laugh, QUESTION.ahead, QUESTION.cook, LOOP],
  );
  await rows(
    `insert into issues (id, group_id, number, status, slot_at, opens_at, delivers_at, delivered_at) values
      ($1, $3, 1, 'delivered', '2026-10-30T08:00:00Z', '2026-10-23T08:00:00Z', '2026-10-30T08:00:00Z', '2026-10-30T08:00:00Z'),
      ($2, $3, 2, 'open', '2026-11-06T08:00:00Z', '2026-10-30T08:00:00Z', '2026-11-06T08:00:00Z', null)`,
    [DELIVERED, OPEN, LOOP],
  );
  await rows(
    `insert into issue_questions (id, issue_id, question_id, text, position) values
      ($1, $6, $8, 'What made you laugh this week?', 0),
      ($2, $6, $9, 'What are you looking forward to?', 1),
      ($3, $7, $8, 'What made you laugh this week?', 0),
      ($4, $7, $9, 'What are you looking forward to?', 1),
      ($5, $7, $10, 'What did you cook?', 2)`,
    [ASK.deliveredLaugh, ASK.deliveredAhead, ASK.openLaugh, ASK.openAhead, ASK.openCook, DELIVERED, OPEN, QUESTION.laugh, QUESTION.ahead, QUESTION.cook],
  );
  await rows(
    `insert into replies (id, issue_id, issue_question_id, membership_id, body, status, submitted_at) values
      ($1, $4, $6, $9, 'The goose.', 'submitted', now()),
      ($2, $4, $7, $9, 'Spring.', 'submitted', now()),
      ($3, $5, $8, $9, 'The cat.', 'submitted', now())`,
    [ANSWER.deliveredLaugh, ANSWER.deliveredAhead, ANSWER.openLaugh, DELIVERED, OPEN, ASK.deliveredLaugh, ASK.deliveredAhead, ASK.openLaugh, SAM],
  );
  await rows("insert into reply_media (id, reply_id, url) values ($1, $2, '/uploads/native.png')", [WALL_PHOTO, ANSWER.deliveredAhead]);

  // The legacy loop content, every id already taken above.
  await rows(
    `insert into sections (id, group_id, kind, title, emoji, position) values
      ($1, $3, 'standard', 'The potluck corner', '🍲', 0),
      ($2, $3, 'photo_wall', 'The fridge wall', '🧲', 1)`,
    [SECTION.standard, SECTION.wall, LOOP],
  );
  await rows(
    "insert into events (id, group_id, kind, title, emoji, month, day, year) values ($1, $2, 'once', 'Housewarming', '🏡', 11, 2, 2026)",
    [EVENT, LOOP],
  );
  await rows(
    `insert into issue_sections (id, issue_id, section_id, kind, title, position, event_id, event_date) values
      ($1, $5, $7, 'standard', 'The potluck corner', 0, null, null),
      ($2, $5, $8, 'photo_wall', 'The fridge wall', 1, null, null),
      ($3, $6, $7, 'standard', 'The potluck corner', 0, null, null),
      ($4, $6, $8, 'photo_wall', 'The fridge wall', 1, null, null),
      ($9, $6, null, 'standard', 'Housewarming', 2, $10, '2026-11-02')`,
    [ROUND_SECTION.deliveredStandard, ROUND_SECTION.deliveredWall, ROUND_SECTION.openStandard, ROUND_SECTION.openWall,
      DELIVERED, OPEN, SECTION.standard, SECTION.wall, id(25), EVENT],
  );
  await rows(
    `insert into section_replies (id, issue_id, issue_section_id, membership_id, body, status, submitted_at) values
      ($1, $4, $6, $9, 'Lemon cake.', 'submitted', now()),
      ($2, $4, $7, $9, '', 'submitted', now()),
      ($3, $5, $8, $10, 'Banana bread.', 'submitted', now())`,
    [SECTION_ANSWER.deliveredStandard, SECTION_ANSWER.deliveredWall, SECTION_ANSWER.openStandard, DELIVERED, OPEN,
      ROUND_SECTION.deliveredStandard, ROUND_SECTION.deliveredWall, ROUND_SECTION.openStandard, BOB, BOB],
  );
  await rows("insert into section_media (id, section_reply_id, url, caption) values ($1, $2, '/uploads/legacy.png', 'Leftovers')", [SECTION_PHOTO, SECTION_ANSWER.deliveredWall]);
}

const NATIVE_TABLES = ["questions", "issue_questions", "replies", "reply_media"] as const;
const NATIVE_IDS = [
  ...Object.values(QUESTION),
  ...Object.values(ASK),
  ...Object.values(ANSWER),
  WALL_PHOTO,
];

/** Every native row, whole, so any change to one shows. */
async function nativeRows(): Promise<string> {
  const out: Record<string, unknown> = {};
  for (const table of NATIVE_TABLES) {
    out[table] = await rows(`select to_jsonb(t) as row from ${table} t where id = any($1::uuid[]) order by id`, [NATIVE_IDS]);
  }
  return JSON.stringify(out);
}

async function mapped(kind: string, legacyId: string): Promise<string> {
  const [row] = await rows<{ unified_id: string }>("select unified_id from unify_ids where kind = $1 and legacy_id = $2", [kind, legacyId]);
  assert.ok(row, `${kind} ${legacyId} has a copy`);
  return row.unified_id;
}

/** The copy is complete, every collided id got a fresh one, and the copies link to each other. */
async function assertCopied(): Promise<void> {
  const section = { standard: await mapped("section", SECTION.standard), wall: await mapped("section", SECTION.wall) };
  const event = await mapped("event", EVENT);
  for (const unified of [section.standard, section.wall, event]) assert.ok(!NATIVE_IDS.includes(unified), "a taken id gets a fresh one");

  const pool = await rows<{ id: string; text: string; frequency: string; format: string; active: boolean }>(
    "select id, text, frequency, format, active from questions where id = any($1::uuid[]) order by text",
    [[section.standard, section.wall, event]],
  );
  assert.deepEqual(pool.map((row) => [row.text, row.frequency, row.format, row.active]), [
    ["Housewarming", "on_date", "written", false],
    ["The fridge wall", "every_round", "photo_wall", false],
    ["The potluck corner", "every_round", "written", false],
  ]);

  const rounds = {
    deliveredStandard: await mapped("issue_section", ROUND_SECTION.deliveredStandard),
    deliveredWall: await mapped("issue_section", ROUND_SECTION.deliveredWall),
    openStandard: await mapped("issue_section", ROUND_SECTION.openStandard),
    openWall: await mapped("issue_section", ROUND_SECTION.openWall),
    openEvent: await mapped("issue_section", id(25)),
  };
  const asks = await rows<{ id: string; issue_id: string; question_id: string | null; from_section: boolean; text: string }>(
    "select id, issue_id, question_id, from_section, text from issue_questions where id = any($1::uuid[])",
    [Object.values(rounds)],
  );
  const ask = (unified: string) => asks.find((row) => row.id === unified)!;
  assert.equal(asks.length, 5);
  assert.ok(asks.every((row) => row.from_section));
  // Linked to the section's copy, not to the native question that shares the section's old id.
  assert.equal(ask(rounds.deliveredStandard).question_id, section.standard);
  assert.equal(ask(rounds.deliveredWall).question_id, section.wall);
  assert.equal(ask(rounds.openStandard).question_id, section.standard);
  assert.equal(ask(rounds.openWall).question_id, section.wall);
  assert.equal(ask(rounds.openEvent).question_id, event);
  assert.ok(Object.values(rounds).every((unified) => !NATIVE_IDS.includes(unified)));

  const answers = {
    deliveredStandard: await mapped("section_reply", SECTION_ANSWER.deliveredStandard),
    deliveredWall: await mapped("section_reply", SECTION_ANSWER.deliveredWall),
    openStandard: await mapped("section_reply", SECTION_ANSWER.openStandard),
  };
  const copiedAnswers = await rows<{ id: string; issue_question_id: string; membership_id: string; body: string }>(
    "select id, issue_question_id, membership_id, body from replies where id = any($1::uuid[])",
    [Object.values(answers)],
  );
  const answer = (unified: string) => copiedAnswers.find((row) => row.id === unified)!;
  assert.equal(copiedAnswers.length, 3);
  assert.deepEqual(answer(answers.deliveredStandard), { id: answers.deliveredStandard, issue_question_id: rounds.deliveredStandard, membership_id: BOB, body: "Lemon cake." });
  assert.equal(answer(answers.deliveredWall).issue_question_id, rounds.deliveredWall);
  assert.equal(answer(answers.openStandard).issue_question_id, rounds.openStandard);

  const photo = await mapped("section_media", SECTION_PHOTO);
  assert.notEqual(photo, WALL_PHOTO);
  const [copiedPhoto] = await rows<{ reply_id: string; url: string; caption: string }>("select reply_id, url, caption from reply_media where id = $1", [photo]);
  assert.deepEqual(copiedPhoto, { reply_id: answers.deliveredWall, url: "/uploads/legacy.png", caption: "Leftovers" });
}

for (const [label, migrate] of [["copied by the mirror triggers", false], ["migrated by 0023 from PR A's state", true]] as const) {
  test(`${label}: no native row changes, and every legacy row is copied under a fresh id and linked`, async () => {
    await seed();
    if (migrate) await undoUnifiedCopy();
    if (migrate) assert.equal((await rows("select 1 from unify_ids")).length, 0);
    const before = await nativeRows();
    if (migrate) await runMigrationFile(MIGRATION);
    assert.equal(await nativeRows(), before);
    await assertCopied();

    // Running it again changes nothing.
    const counts = async () => JSON.stringify(await rows("select (select count(*) from questions) q, (select count(*) from issue_questions) iq, (select count(*) from replies) r, (select count(*) from reply_media) m, (select count(*) from unify_ids) u"));
    const settled = await counts();
    await runMigrationFile(MIGRATION);
    assert.equal(await counts(), settled);
    assert.equal(await nativeRows(), before);
    await assertCopied();
  });
}

test("later legacy writes on a collided id reach only the copy", async () => {
  await seed();
  const before = await nativeRows();

  await rows("update sections set title = 'The potluck corner, revisited' where id = $1", [SECTION.standard]);
  await rows("update events set title = 'Big housewarming' where id = $1", [EVENT]);
  await rows("update issue_sections set title = 'The fridge, revisited' where id = $1", [ROUND_SECTION.openWall]);
  await rows("update section_replies set body = 'Two cakes.' where id = $1", [SECTION_ANSWER.deliveredStandard]);
  await rows("update section_media set caption = 'Seconds' where id = $1", [SECTION_PHOTO]);
  assert.equal(await nativeRows(), before);
  const [section] = await rows<{ text: string }>("select text from questions where id = $1", [await mapped("section", SECTION.standard)]);
  assert.equal(section.text, "The potluck corner, revisited");
  const [event] = await rows<{ text: string }>("select text from questions where id = $1", [await mapped("event", EVENT)]);
  assert.equal(event.text, "Big housewarming");
  const [ask] = await rows<{ text: string }>("select text from issue_questions where id = $1", [await mapped("issue_section", ROUND_SECTION.openWall)]);
  assert.equal(ask.text, "The fridge, revisited");
  const [answer] = await rows<{ body: string }>("select body from replies where id = $1", [await mapped("section_reply", SECTION_ANSWER.deliveredStandard)]);
  assert.equal(answer.body, "Two cakes.");
  const [photo] = await rows<{ caption: string }>("select caption from reply_media where id = $1", [await mapped("section_media", SECTION_PHOTO)]);
  assert.equal(photo.caption, "Seconds");

  // Deletes too: the copies go, the native rows sharing their old ids stay.
  const copies = {
    photo: await mapped("section_media", SECTION_PHOTO),
    answer: await mapped("section_reply", SECTION_ANSWER.deliveredStandard),
    ask: await mapped("issue_section", ROUND_SECTION.openWall),
    section: await mapped("section", SECTION.wall),
    event: await mapped("event", EVENT),
  };
  await rows("delete from section_media where id = $1", [SECTION_PHOTO]);
  await rows("delete from section_replies where id = $1", [SECTION_ANSWER.deliveredStandard]);
  await rows("delete from issue_sections where id = $1", [ROUND_SECTION.openWall]);
  await rows("delete from sections where id = $1", [SECTION.wall]);
  await rows("delete from events where id = $1", [EVENT]);
  assert.equal(await nativeRows(), before);
  assert.equal((await rows("select 1 from reply_media where id = $1", [copies.photo])).length, 0);
  assert.equal((await rows("select 1 from replies where id = $1", [copies.answer])).length, 0);
  assert.equal((await rows("select 1 from issue_questions where id = $1", [copies.ask])).length, 0);
  assert.equal((await rows("select 1 from questions where id = any($1::uuid[])", [[copies.section, copies.event]])).length, 0);
});

test("an old sheet's writes by legacy id land on the copy, and the open round isn't asked twice", async () => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": "2026-11-01T09:00:00Z" });
  await seed();
  const before = await nativeRows();
  const openStandard = await mapped("issue_section", ROUND_SECTION.openStandard);
  const openWall = await mapped("issue_section", ROUND_SECTION.openWall);

  assert.equal(await unifiedIdOf("issue_section", ROUND_SECTION.openStandard), openStandard);
  assert.equal(await unifiedIdOf("issue_section", "not-a-uuid"), "not-a-uuid");
  assert.equal(await unifiedIdOf("issue_section", id(999)), id(999), "never copied: passed through");

  // `sectionDraft` with the round section's old id: Bob's own answer on the copy, the native row untouched.
  assert.equal((await saveSectionTextFor({ token: TOKEN, issueSectionId: ROUND_SECTION.openStandard, body: "Banana bread, twice." })).ok, true);
  const [bread] = await rows<{ body: string }>("select body from replies where issue_question_id = $1 and membership_id = $2", [openStandard, BOB]);
  assert.equal(bread.body, "Banana bread, twice.");
  assert.equal(await nativeRows(), before);

  // `sectionMusic` resolves the same way: the copy is a photo wall, so it is refused there, not on the native question.
  const music = await saveSectionMusicFor({ token: TOKEN, issueSectionId: ROUND_SECTION.openWall, url: "https://open.spotify.com/track/x", caption: "" });
  assert.equal(music.ok, false);
  assert.equal(await nativeRows(), before);

  // `/section-media` removal with a photo's old id finds nothing of Bob's to take, and touches nothing native.
  const removed = await removeSectionMediaFor({ token: TOKEN, issueSectionId: ROUND_SECTION.openWall, mediaId: SECTION_PHOTO });
  assert.equal(removed.ok, false);
  assert.equal(await nativeRows(), before);

  // The sheet knows each card's old id, for words an old sheet kept on the device.
  const sheet = await sheetFor(TOKEN);
  assert.ok(sheet);
  assert.equal(sheet.questions.find((item) => item.id === openWall)?.legacyId, ROUND_SECTION.openWall);
  assert.equal(sheet.questions.find((item) => item.id === ASK.openCook)?.legacyId, ASK.openCook);

  // Every section copy in the open round is linked, so topping the round up adds nothing twice.
  const asked = async () => (await rows<{ n: number }>("select count(*)::int as n from issue_questions where issue_id = $1", [OPEN]))[0].n;
  const count = await asked();
  await fillOpenRound(LOOP);
  assert.equal(await asked(), count);
});

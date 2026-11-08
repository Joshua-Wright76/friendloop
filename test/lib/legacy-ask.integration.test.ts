/*
 * The tolerate rule (src/lib/legacy-ask.ts): while sections still live in their own
 * tables, rows the next release copies into `questions`, `issue_questions` and
 * `replies` are invisible here. Past rounds are covered by the golden test; this is
 * the open round and the pool, where this code also writes.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { answeredMemberIds } from "../../src/lib/answered.ts";
import { answeredCountSql } from "../../src/lib/reply-query.ts";
import { roundAsks } from "../../src/lib/notify.ts";
import { saveDraftFor, sheetFor } from "../../src/lib/reply.ts";
import { toggleReactionFor } from "../../src/lib/reactions.ts";
import { postComment } from "../../src/lib/comments.ts";
import { addQuestion, addQuestionTexts, archiveQuestion, reorderQuestion, toggleSkipNext } from "../../src/lib/manage.ts";
import { snapshotSectionsForIssue } from "../../src/lib/sections.ts";
import { AFTER_FIRST_SLOT, groupOf, rows, seedLoop, seedOpenIssue, setupDatabase } from "../support/app.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { copyLikeUnify } from "../../e2e/support/golden.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

/** A loop with two questions and a poll, a photo wall, and a round open with Alice's wall answer in it. */
async function openRoundWithCopy() {
  const loop = await seedLoop();
  await seedPoll(loop, { text: "Tea or coffee?", options: ["Tea", "Coffee"] });
  await rows("insert into sections (group_id, kind, title, position) values ($1, 'photo_wall', 'Photo wall', 0)", [loop.groupId]);
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  await snapshotSectionsForIssue({ group: await groupOf(loop.groupId), issueId: issue.issueId });
  const [owner, alice] = loop.members;
  const [wall] = await rows<{ id: string }>("select id from issue_sections where issue_id = $1", [issue.issueId]);
  const [aliceWall] = await rows<{ id: string }>(
    "insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'Lake', 'submitted') returning id",
    [issue.issueId, wall.id, alice.id],
  );
  await rows("insert into section_media (section_reply_id, url) values ($1, '/uploads/lake.png')", [aliceWall.id]);
  const legacy = await rows<{ id: string }>("select id from issue_questions where issue_id = $1 order by position", [issue.issueId]);

  await copyLikeUnify();
  const [music] = await rows<{ id: string }>("select id from replies where membership_id = $1 and link_url is not null", [owner.id]);
  return { loop, issue, owner, alice, wallId: wall.id, aliceWallId: aliceWall.id, musicReplyId: music.id, legacyIds: legacy.map((row) => row.id) };
}

test("a format left out is filled from the kind, and one given is kept", async () => {
  const world = await openRoundWithCopy();
  const pool = await rows<{ text: string; format: string }>(
    "select text, format::text from questions where group_id = $1 order by text",
    [world.loop.groupId],
  );
  assert.deepEqual([...pool], [
    { text: "Photo wall", format: "photo_wall" },
    { text: "Tea or coffee?", format: "poll" },
    { text: "Weekend photos", format: "photo_wall" },
    { text: "What are you looking forward to?", format: "written" },
    { text: "What made you laugh this week?", format: "written" },
  ]);
  const asked = await rows<{ format: string; from_section: boolean }>(
    "select format::text, from_section from issue_questions where issue_id = $1 order by position",
    [world.issue.issueId],
  );
  assert.deepEqual([...asked], [
    { format: "written", from_section: false },
    { format: "written", from_section: false },
    { format: "poll", from_section: false },
    { format: "music", from_section: false },
    { format: "photo_wall", from_section: true },
  ]);
});

test("the open round's sheet, prompts and progress see only this code's questions", async () => {
  const world = await openRoundWithCopy();

  const sheet = await sheetFor(world.alice.token);
  assert.deepEqual(sheet?.questions.map((question) => question.id), world.legacyIds);

  const asks = await roundAsks(world.issue.issueId);
  assert.deepEqual(asks("member"), [
    "What made you laugh this week?",
    "What are you looking forward to?",
    "Tea or coffee?",
    "Photo wall",
  ]);

  // The owner's only answer is to the music item the next release wrote: not one here.
  // Alice's photo wall answer counts once, through its section.
  const answered = await answeredMemberIds(world.issue.issueId);
  assert.deepEqual([...answered], [world.alice.id]);
  const [{ people }] = await db.execute<{ people: number }>(
    sql`select ${answeredCountSql("i")} as people from issues i where i.id = ${world.issue.issueId}`,
  );
  assert.equal(people, 1);
});

test("this code never writes into, reacts to or comments on a copied ask", async () => {
  const world = await openRoundWithCopy();

  const draft = await saveDraftFor({ token: world.alice.token, issueQuestionId: world.wallId, body: "Into the copy" });
  assert.equal(draft.ok === false && draft.status, 409);

  const reaction = await toggleReactionFor({ issueId: world.issue.issueId, replyId: world.aliceWallId, membershipId: world.owner.id, emoji: "❤️" });
  assert.deepEqual(reaction, { ok: false, reason: "answer" });

  const comment = await postComment({ issueId: world.issue.issueId, viewerToken: world.owner.token, replyId: world.musicReplyId, body: "Tune" });
  assert.equal(comment.ok === false && comment.status, 404);
  assert.equal((await rows("select 1 from reactions union all select 1 from comments")).length, 0);
});

test("editing the pool leaves the copy where it is", async () => {
  const world = await openRoundWithCopy();
  const copiedBefore = await rows("select id, position from issue_questions where issue_id = $1 and (from_section or format not in ('written', 'poll')) order by id", [world.issue.issueId]);
  const copiedPool = () => rows("select id, position, archived_at, skip_next from questions where group_id = $1 and not active order by id", [world.loop.groupId]);
  const poolBefore = await copiedPool();
  assert.equal(poolBefore.length, 2);

  // Adding re-syncs the open round; it must not take out what it didn't put in.
  await addQuestion(world.loop.groupId, "What did you cook?", AFTER_FIRST_SLOT);
  assert.deepEqual(
    await rows("select id, position from issue_questions where issue_id = $1 and (from_section or format not in ('written', 'poll')) order by id", [world.issue.issueId]),
    copiedBefore,
  );

  // A copied section with a question's name is not a question already in the pool.
  assert.equal(await addQuestionTexts(world.loop.groupId, ["Photo wall"], AFTER_FIRST_SLOT), 1);

  const [first] = await rows<{ id: string }>("select id from questions where group_id = $1 and active order by position limit 1", [world.loop.groupId]);
  assert.equal(await reorderQuestion(world.loop.groupId, first.id, 3), true);
  const [copiedSection] = await rows<{ id: string }>("select id from questions where group_id = $1 and text = 'Photo wall' and not active", [world.loop.groupId]);
  await archiveQuestion(world.loop.groupId, copiedSection.id, AFTER_FIRST_SLOT);
  assert.equal(await toggleSkipNext(world.loop.groupId, copiedSection.id), false);
  assert.deepEqual(await copiedPool(), poolBefore);
});

test("rows from before migration 0022 get their format from its own backfill", async () => {
  const loop = await seedLoop();
  await seedPoll(loop, { text: "Tea or coffee?", options: ["Tea", "Coffee"] });
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  // What the tables held before the column existed: no format at all.
  await rows("update questions set format = null");
  await rows("update issue_questions set format = null");

  const migration = readFileSync(path.join(process.cwd(), "drizzle", "0022_questions_expand.sql"), "utf8");
  const backfill = migration.split("--> statement-breakpoint").map((part) => part.trim()).filter((part) => /^UPDATE\b/m.test(part));
  assert.equal(backfill.length, 2);
  for (const statement of backfill) await rows(statement.replace(/^--.*$/gm, "").trim());

  const formats = await rows<{ format: string }>(
    "select format::text from issue_questions where issue_id = $1 union all select format::text from questions where group_id = $2",
    [issue.issueId, loop.groupId],
  );
  assert.deepEqual(formats.map((row) => row.format).sort(), ["poll", "poll", "written", "written", "written", "written"]);
});

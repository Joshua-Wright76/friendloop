/*
 * Migration `0030`, the first half of the contract (docs/questions-unify-design.md).
 *
 * The section mirror triggers and copy functions are gone; `format` is required on
 * the pool and on every round's snapshot. The release before it still creates a
 * loop's first questions without a format, so the fill trigger stays and fills it
 * from `kind`; the release that ships with it no longer writes `kind`, so the same
 * trigger keeps `kind` in step with `format` for a rollback. Running it again is safe.
 *
 * The follow-up that drops `kind` and the fill trigger deletes this test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rows, seedLoop, setupDatabase } from "../support/app.ts";
import { runMigrationFile } from "../../e2e/support/db.ts";

setupDatabase();

const MIGRATION = path.join(process.cwd(), "drizzle", "0030_questions_contract.sql");

const kindAndFormat = async (table: "questions" | "issue_questions", id: string) =>
  (await rows<{ kind: string; format: string }>(`select kind, format from ${table} where id = $1`, [id]))[0];

test("0030 leaves no mirror trigger or copy function behind, and requires a format", async () => {
  await runMigrationFile(MIGRATION);
  const triggers = await rows<{ tgname: string }>("select tgname from pg_trigger where not tgisinternal order by tgname");
  assert.deepEqual(triggers.map((row) => row.tgname), ["issue_questions_fill_format", "questions_fill_format"]);
  const functions = await rows<{ proname: string }>(
    "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by proname",
  );
  assert.deepEqual(functions.map((row) => row.proname), ["fill_format_from_kind"]);
  const nullable = await rows<{ table_name: string; is_nullable: string }>(
    "select table_name, is_nullable from information_schema.columns where column_name = 'format' and table_name in ('questions', 'issue_questions') order by table_name",
  );
  assert.deepEqual(nullable.map((row) => `${row.table_name}:${row.is_nullable}`), ["issue_questions:NO", "questions:NO"]);
});

test("0030 fills a format left out, and keeps kind in step with format", async () => {
  const loop = await seedLoop({ questions: [] });

  // The release before: no format, maybe a poll's kind.
  const [plain] = await rows<{ id: string }>("insert into questions (group_id, text) values ($1, 'Old written') returning id", [loop.groupId]);
  const [oldPoll] = await rows<{ id: string }>("insert into questions (group_id, text, kind) values ($1, 'Old poll', 'poll') returning id", [loop.groupId]);
  assert.deepEqual({ ...(await kindAndFormat("questions", plain.id)) }, { kind: "written", format: "written" });
  assert.deepEqual({ ...(await kindAndFormat("questions", oldPoll.id)) }, { kind: "poll", format: "poll" });

  // This release: a format, never a kind.
  const [poll] = await rows<{ id: string }>("insert into questions (group_id, text, format) values ($1, 'New poll', 'poll') returning id", [loop.groupId]);
  assert.deepEqual({ ...(await kindAndFormat("questions", poll.id)) }, { kind: "poll", format: "poll" });
  await rows("update questions set format = 'photo_wall' where id = $1", [poll.id]);
  assert.deepEqual({ ...(await kindAndFormat("questions", poll.id)) }, { kind: "written", format: "photo_wall" });
  await rows("update questions set format = 'poll' where id = $1", [poll.id]);
  assert.deepEqual({ ...(await kindAndFormat("questions", poll.id)) }, { kind: "poll", format: "poll" });

  // A round's snapshot follows the same rule.
  const [issue] = await rows<{ id: string }>(
    "insert into issues (group_id, number, slot_at, opens_at, delivers_at) values ($1, 1, now(), now(), now()) returning id",
    [loop.groupId],
  );
  const [snapshot] = await rows<{ id: string }>(
    "insert into issue_questions (issue_id, question_id, text, format) values ($1, $2, 'New poll', 'poll') returning id",
    [issue.id, poll.id],
  );
  assert.deepEqual({ ...(await kindAndFormat("issue_questions", snapshot.id)) }, { kind: "poll", format: "poll" });
  const [oldSnapshot] = await rows<{ id: string }>(
    "insert into issue_questions (issue_id, question_id, text) values ($1, $2, 'Old written') returning id",
    [issue.id, plain.id],
  );
  assert.deepEqual({ ...(await kindAndFormat("issue_questions", oldSnapshot.id)) }, { kind: "written", format: "written" });
});

/*
 * Migration `0029`: every loop takes turns through one list, five a round.
 *
 * Seeds loops the way the release before it left them, runs the real migration
 * file the way the deploy does, and checks who is touched. A loop that asked
 * everything is topped up to fifteen questions and asks five a round; if it has
 * sent a round, its open round is refreshed (what's written in and what's dated
 * stay), and if it is still on its first round that round stays whole. A loop that
 * already took turns is left alone. Running it again changes nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { rows, setupDatabase } from "../support/app.ts";
import { runMigrationFile } from "../../e2e/support/db.ts";
import { QUESTION_PACKS } from "../../src/lib/question-packs.ts";
import { STARTER_PACK_IDS } from "../../src/lib/starter-questions.ts";

setupDatabase();

const MIGRATION = path.join(process.cwd(), "drizzle", "0029_rotate_by_default.sql");
const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const SENT = id(1);
const FIRST = id(2);
const TURNS = id(3);

async function loop(groupId: string, name: string, perRound: number | null, texts: string[], sentARound: boolean): Promise<{ open: string; member: string }> {
  await rows("insert into groups (id, name, questions_per_round) values ($1, $2, $3)", [groupId, name, perRound]);
  const [member] = await rows<{ id: string }>(
    "insert into memberships (group_id, email, reply_token) values ($1, $2, $3) returning id",
    [groupId, `${name}@friendloop.test`, `token-${name}`],
  );
  const sent = sentARound
    ? (await rows<{ id: string }>(
      "insert into issues (group_id, number, status, slot_at, opens_at, delivers_at, delivered_at) values ($1, 1, 'delivered', '2026-01-02', '2026-01-01', '2026-01-02', '2026-01-02') returning id",
      [groupId],
    ))[0].id
    : null;
  const [open] = await rows<{ id: string }>(
    "insert into issues (group_id, number, status, slot_at, opens_at, delivers_at) values ($1, $2, 'open', '2026-01-09', '2026-01-02', '2026-01-09') returning id",
    [groupId, sentARound ? 2 : 1],
  );
  for (const [position, text] of texts.entries()) {
    const [question] = await rows<{ id: string }>(
      "insert into questions (group_id, text, position, frequency, format) values ($1, $2, $3, 'rotating', 'written') returning id",
      [groupId, text, position],
    );
    // Asking everything, the round that went out asked the same ones.
    for (const issueId of [sent, open.id]) {
      if (issueId) await rows("insert into issue_questions (issue_id, question_id, text, position) values ($1, $2, $3, $4)", [issueId, question.id, text, position]);
    }
  }
  return { open: open.id, member: member.id };
}

const asked = async (issueId: string) =>
  (await rows<{ text: string }>("select text from issue_questions where issue_id = $1 order by position", [issueId])).map((row) => row.text);
const queue = async (groupId: string) =>
  (await rows<{ text: string }>("select text from questions where group_id = $1 and frequency = 'rotating' order by position", [groupId])).map((row) => row.text);
const perRound = async (groupId: string) =>
  (await rows<{ n: number | null }>("select questions_per_round as n from groups where id = $1", [groupId]))[0].n;

test("0029 makes every loop take turns five at a time, tops it up, and refreshes the open round of a loop that has sent one", async () => {
  // Asked everything, has sent a round: five questions, one asked every round, a birthday, and an answer to Q5.
  const sent = await loop(SENT, "sent", null, ["Q1", "Q2", "Q3", "Q4", "Q5"], true);
  const [wall] = await rows<{ id: string }>(
    "insert into questions (group_id, text, position, frequency, format) values ($1, 'Wall', 0, 'every_round', 'photo_wall') returning id", [SENT]);
  await rows("insert into issue_questions (issue_id, question_id, text, position) values ($1, $2, 'Wall', 5)", [sent.open, wall.id]);
  const [birthday] = await rows<{ id: string }>(
    "insert into questions (group_id, text, frequency, format, active, date_kind, month, day) values ($1, 'Party', 'on_date', 'written', false, 'once', 1, 6) returning id", [SENT]);
  await rows("insert into issue_questions (issue_id, question_id, text, position, occurrence_date) values ($1, $2, 'Party', 6, '2026-01-06')", [sent.open, birthday.id]);
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, body, status) select $1, id, $2, 'Mine.', 'submitted' from issue_questions where issue_id = $1 and text = 'Q5'",
    [sent.open, sent.member],
  );
  // Still on its first round, and one that already took turns two at a time with a fuller round open.
  const first = await loop(FIRST, "first", null, ["A1", "A2", "A3", "A4"], false);
  const turns = await loop(TURNS, "turns", 2, ["T1", "T2", "T3", "T4"], true);

  await runMigrationFile(MIGRATION);

  // Each loop is topped up with everyday questions in an order of its own: "+" stands for one of them.
  const everyday = new Set(QUESTION_PACKS.filter((pack) => STARTER_PACK_IDS.includes(pack.id)).flatMap((pack) => pack.questions));
  const shape = (texts: string[]) => texts.map((text) => (everyday.has(text) ? "+" : text));
  const plus = (count: number) => Array.from({ length: count }, () => "+");

  // Six of its own (the every-round one takes turns now), so nine more make fifteen.
  // The answered one stays; the rest of the round is questions no round has asked; the date stays last.
  const sentRound = await asked(sent.open);
  assert.deepEqual(shape(sentRound), ["Q5", "Wall", "+", "+", "+", "Party"]);
  // Next in line: the ones never asked, then the ones the last round asked, then this round's.
  assert.deepEqual(shape(await queue(SENT)), [...plus(6), "Q1", "Q2", "Q3", "Q4", "Wall", ...plus(3), "Q5"]);
  assert.equal(new Set(await queue(SENT)).size, 15, "no question twice");
  assert.equal(await perRound(SENT), 5);
  assert.equal((await rows("select 1 from replies where issue_id = $1", [sent.open])).length, 1);

  // Still on its first round: the round is whole, and the new questions are first in line.
  assert.deepEqual(await asked(first.open), ["A1", "A2", "A3", "A4"]);
  assert.deepEqual(shape(await queue(FIRST)), [...plus(11), "A1", "A2", "A3", "A4"]);
  // Two loops are not handed the same questions in the same order.
  assert.notDeepEqual((await queue(FIRST)).slice(0, 5), (await queue(SENT)).slice(0, 5));
  assert.equal(await perRound(FIRST), 5);

  assert.deepEqual(await asked(turns.open), ["T1", "T2", "T3", "T4"]);
  assert.deepEqual(await queue(TURNS), ["T1", "T2", "T3", "T4"]);
  assert.equal(await perRound(TURNS), 2);

  assert.equal((await rows("select 1 from questions where frequency = 'every_round'")).length, 0);

  // Again, as a retried deploy would: nothing moves.
  await runMigrationFile(MIGRATION);
  assert.deepEqual(await asked(sent.open), sentRound);
  assert.equal((await queue(SENT)).length, 15);
  assert.deepEqual(await asked(first.open), ["A1", "A2", "A3", "A4"]);
  assert.equal((await queue(FIRST)).length, 15);
});

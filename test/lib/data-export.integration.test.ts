import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_FORMAT,
  accountExport,
  exportFilename,
  jsonDocument,
  loopArchive,
  replyLinkExport,
  toStream,
} from "../../src/lib/data-export.ts";
import { exportResponse } from "../../src/lib/export-response.ts";
import { addMember, rows, seedDeliveredIssue, seedLoop, setupDatabase } from "../support/app.ts";
import { seedPoll } from "../../e2e/support/polls.ts";
import { E2E_NOW } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

setupDatabase();

async function collect(chunks: AsyncGenerator<string>): Promise<string> {
  let out = "";
  for await (const chunk of chunks) out += chunk;
  return out;
}

const PHOTO = "https://store123.public.blob.vercel-storage.com/reply-photos/aa.png";

/** A loop with a delivered round: Wren and Alice answered, a poll, a section, comments, a draft. */
async function seedArchive() {
  const loop = await seedLoop({ members: [{ email: "alice@friendloop.test", name: "Alice" }] });
  const wren = await addMember(loop, { email: "wren@friendloop.test" });
  loop.members.push({ ...wren, participation: "contributor", access: "member" });
  const alice = loop.members.find((member) => member.email === "alice@friendloop.test")!;
  const [user] = await rows<{ id: string }>("insert into users (email, name) values ('wren@friendloop.test', 'Wren') returning id");
  await rows("update memberships set user_id = $1, photo_url = '/uploads/avatar.png' where id = $2", [user.id, wren.id]);
  await rows("update groups set header_image_url = 'http://[broken' where id = $1", [loop.groupId]);

  const issue = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [
      { email: "wren@friendloop.test", body: "Wren laughed" },
      { email: "alice@friendloop.test", body: "Alice laughed" },
    ],
  });
  // The poll joins the pool and the round after the written answers, so they never share a question.
  const pollQuestion = await seedPoll(loop, { text: "Lake or sea?", options: ["Lake", "Sea"] });
  const poll = await rows<{ id: string }>(
    "insert into issue_questions (issue_id, question_id, text, position, kind, poll_options) values ($1, $2, 'Lake or sea?', 2, 'poll', '[\"Lake\", \"Sea\"]') returning id",
    [issue.issueId, pollQuestion],
  );
  await rows(
    "insert into replies (issue_id, issue_question_id, membership_id, poll_choices, status, submitted_at) values ($1, $2, $3, '[1, 7]', 'submitted', now())",
    [issue.issueId, poll[0].id, wren.id],
  );
  const second = await rows<{ id: string }>(
    "select id from issue_questions where issue_id = $1 and kind = 'written' and id not in (select issue_question_id from replies where membership_id = $2)",
    [issue.issueId, alice.id],
  );
  // A draft the round went out without, from before answers saved straight into the round.
  await rows("insert into replies (issue_id, issue_question_id, membership_id, body, status, never_sent) values ($1, $2, $3, 'Alice draft', 'draft', true)", [issue.issueId, second[0].id, alice.id]);
  await rows("update replies set photo_url = $1 where membership_id = $2 and body = 'Wren laughed'", [PHOTO, wren.id]);

  const wrenReply = await rows<{ id: string }>("select id from replies where membership_id = $1 and body = 'Wren laughed'", [wren.id]);
  await rows("insert into comments (issue_id, membership_id, body) values ($1, $2, $3)", [issue.issueId, wren.id, `Thanks @[${alice.id}]`]);
  await rows("insert into comments (issue_id, membership_id, body, reply_id) values ($1, $2, 'Ha', $3)", [issue.issueId, alice.id, wrenReply[0].id]);
  await rows("insert into comments (issue_id, membership_id, body, deleted_at) values ($1, $2, 'Taken down', now())", [issue.issueId, alice.id]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '🎉')", [wrenReply[0].id, alice.id]);
  const aliceReply = await rows<{ id: string }>("select id from replies where membership_id = $1 and status = 'submitted'", [alice.id]);
  await rows("insert into reactions (reply_id, membership_id, emoji) values ($1, $2, '💛')", [aliceReply[0].id, wren.id]);
  await rows("insert into question_suggestions (group_id, membership_id, text) values ($1, $2, 'Favourite tree?')", [loop.groupId, wren.id]);

  const [wall] = await rows<{ id: string }>("insert into issue_sections (issue_id, kind, title) values ($1, 'photo_wall', 'Wall') returning id", [issue.issueId]);
  const [entry] = await rows<{ id: string }>("insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'My week', 'submitted') returning id", [issue.issueId, wall.id, wren.id]);
  await rows("insert into section_media (section_reply_id, url, caption) values ($1, $2, 'Hike')", [entry.id, PHOTO]);
  await rows("insert into section_replies (issue_id, issue_section_id, membership_id, body, status) values ($1, $2, $3, 'Alice wall', 'submitted')", [issue.issueId, wall.id, alice.id]);

  return { loop, wren, alice, userId: user.id, issue };
}

test("a person's export holds their own words in every loop, drafts included, and nobody else's", async () => {
  const world = await seedArchive();
  const chunks = await accountExport(world.userId, E2E_NOW);
  assert.ok(chunks);
  const data = JSON.parse(await collect(chunks));

  assert.equal(data.format, EXPORT_FORMAT);
  assert.equal(data.exportedAt, E2E_NOW.toISOString());
  assert.equal(data.account.email, "wren@friendloop.test");
  assert.equal(data.loops.length, 1);

  const [loop] = data.loops;
  assert.equal(loop.loop, "Friday Loop");
  assert.equal(loop.you.photoUrl, "http://localhost:3100/uploads/avatar.png");
  assert.deepEqual(loop.answers.map((answer: { answer: string }) => answer.answer), ["Wren laughed", ""]);
  assert.equal(loop.answers[0].photoUrl, PHOTO);
  assert.equal(loop.answers[0].neverSent, false);
  assert.deepEqual(loop.answers[1].pollChoices, ["Sea"], "a pick that no longer exists is dropped");
  assert.deepEqual(loop.sectionAnswers.map((answer: { answer: string }) => answer.answer), ["My week"]);
  assert.deepEqual(loop.sectionAnswers[0].photos, [{ url: PHOTO, caption: "Hike" }]);
  assert.deepEqual(loop.comments.map((comment: { comment: string }) => comment.comment), ["Thanks @Alice"]);
  assert.deepEqual(loop.reactions.map((reaction: { emoji: string; answerBy: string }) => [reaction.emoji, reaction.answerBy]), [["💛", "Alice"]]);
  assert.deepEqual(loop.suggestions.map((suggestion: { question: string }) => suggestion.question), ["Favourite tree?"]);
  assert.doesNotMatch(JSON.stringify(data), /Alice laughed|Alice draft|Alice wall/);

  // The same words through the reply link, for someone who never signed in.
  const viaLink = await replyLinkExport(world.wren.token, E2E_NOW);
  assert.equal(viaLink?.groupName, "Friday Loop");
  const linked = JSON.parse(await collect(viaLink!.chunks));
  assert.equal(linked.account, undefined);
  assert.deepEqual(linked.loops[0].answers, loop.answers);

  assert.equal(await accountExport("00000000-0000-4000-8000-000000000000", E2E_NOW), null);
  assert.equal(await replyLinkExport("not-a-token", E2E_NOW), null);
});

test("an account with no loops still exports a valid, empty file", async () => {
  const [user] = await rows<{ id: string }>("insert into users (email) values ('lonely@friendloop.test') returning id");
  const data = JSON.parse(await collect((await accountExport(user.id, E2E_NOW))!));
  assert.deepEqual(data.loops, []);
});

test("the loop archive has every round, answer, section, comment and reaction, and no never-sent drafts", async () => {
  const world = await seedArchive();
  const archive = await loopArchive(world.loop.groupId, E2E_NOW);
  assert.equal(archive?.groupName, "Friday Loop");
  const data = JSON.parse(await collect(archive!.chunks));

  assert.equal(data.loop.name, "Friday Loop");
  assert.equal(data.loop.headerImageUrl, "http://[broken", "an address that will not parse is passed through as stored");
  assert.deepEqual(data.members.map((member: { name: string }) => member.name).sort(), ["Alice", "Sam", "wren"]);
  assert.ok(data.questionPool.some((question: { kind: string; options?: string[] }) => question.kind === "poll" && question.options?.length === 2));

  assert.equal(data.rounds.length, 1);
  const [round] = data.rounds;
  const first = round.questions[0];
  assert.deepEqual(first.answers.map((answer: { by: string }) => answer.by).sort(), ["Alice", "wren"]);
  const wrens = first.answers.find((answer: { by: string }) => answer.by === "wren");
  assert.deepEqual(wrens.reactions, [{ by: "Alice", emoji: "🎉" }]);
  const poll = round.questions.find((question: { kind: string }) => question.kind === "poll");
  assert.deepEqual(poll.options, ["Lake", "Sea"]);
  assert.deepEqual(round.sections[0].answers.map((answer: { by: string }) => answer.by).sort(), ["Alice", "wren"]);
  assert.deepEqual(round.comments.map((comment: { comment: string }) => comment.comment).sort(), ["Ha", "Thanks @Alice"]);
  assert.doesNotMatch(JSON.stringify(data), /Alice draft|Taken down/);

  assert.equal(await loopArchive("00000000-0000-4000-8000-000000000000", E2E_NOW), null);
});

test("a loop that never sent a round archives with an empty list", async () => {
  const loop = await seedLoop({ members: [] });
  const data = JSON.parse(await collect((await loopArchive(loop.groupId, E2E_NOW))!.chunks));
  assert.deepEqual(data.rounds, []);
});

test("the stream, the filename and the response headers", async () => {
  async function* two() {
    yield { a: 1 };
    yield { b: [2] };
  }
  const text = await collect(jsonDocument({ format: "x" }, "items", two()));
  assert.deepEqual(JSON.parse(text), { format: "x", items: [{ a: 1 }, { b: [2] }] });

  const reader = toStream(jsonDocument({ format: "x" }, "items", two())).getReader();
  let streamed = "";
  for (let next = await reader.read(); !next.done; next = await reader.read()) streamed += new TextDecoder().decode(next.value);
  assert.equal(streamed, text);
  const cancelled = toStream(jsonDocument({ format: "x" }, "items", two()));
  await cancelled.cancel();

  assert.equal(exportFilename("The Friday Loop!", E2E_NOW), "friendloop-the-friday-loop-2026-01-02.json");
  assert.equal(exportFilename("🍒", E2E_NOW), "friendloop-export-2026-01-02.json");

  const response = exportResponse(jsonDocument({ format: "x" }, "items", two()), "my-data", E2E_NOW);
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="friendloop-my-data-2026-01-02.json"');
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), { format: "x", items: [{ a: 1 }, { b: [2] }] });
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetDatabase,
  rows,
  seedLoop,
  setupDatabase,
} from "../support/app.ts";
import {
  acceptSuggestion,
  createSuggestion,
  declineSuggestion,
  pendingSuggestions,
  suggestionCreditsForQuestions,
  SUGGESTION_MAX_LENGTH,
} from "../../src/lib/suggestions.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const LONG = "a".repeat(SUGGESTION_MAX_LENGTH + 1);

async function memberOf(loop: Awaited<ReturnType<typeof seedLoop>>) {
  return loop.members.find((member) => member.email.startsWith("alice"))!;
}

test("a contributor files a suggestion; bad input doesn't", async () => {
  const loop = await seedLoop();
  const alice = await memberOf(loop);

  assert.equal((await createSuggestion({ token: alice.token, text: "   ", authorDisplay: "name" })).ok, false);
  assert.equal((await createSuggestion({ token: alice.token, text: LONG, authorDisplay: "name" })).ok, false);
  assert.equal((await createSuggestion({ token: alice.token, text: "hi", authorDisplay: "both" as never })).ok, false);
  assert.equal((await createSuggestion({ token: "none", text: "x", authorDisplay: "name" })).ok, false);

  assert.deepEqual(await createSuggestion({ token: alice.token, text: "What's everyone reading?", authorDisplay: "name" }), { ok: true });
  const [row] = await rows<{ status: string; author_display: string }>("select status, author_display from question_suggestions");
  assert.equal(`${row.status}/${row.author_display}`, "pending/name");
});

test("readers and anonymous-only loops cannot suggest", async () => {
  const loop = await seedLoop();
  const alice = await memberOf(loop);
  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  assert.equal((await createSuggestion({ token: alice.token, text: "hi", authorDisplay: "name" })).ok, false);

  const solo = await seedLoop({ mode: "from_you" });
  assert.equal((await createSuggestion({ token: solo.members[0].token, text: "hi", authorDisplay: "name" })).ok, false);
});

test("an expired link cannot suggest; the queue is the owner's to work", async () => {
  const loop = await seedLoop({ owner: null, members: [{ email: "pal@friendloop.test", name: "Pal" }] });
  const [stale] = await rows<{ reply_token: string }>("select reply_token from memberships");
  await rows(
    "update memberships set accepted_at = null, invited_at = $1 where reply_token = $2",
    ["2025-12-01T00:00:00Z", stale.reply_token],
  );
  assert.equal((await createSuggestion({ token: stale.reply_token, text: "hi", authorDisplay: "name" })).ok, false);

  void loop;
  const loop2 = await seedLoop();
  const alice = await memberOf(loop2);
  await createSuggestion({ token: alice.token, text: "What's everyone reading?", authorDisplay: "name" });
  await createSuggestion({ token: alice.token, text: "Who cooked this week?", authorDisplay: "anonymous" });

  const pending = await pendingSuggestions(loop2.groupId);
  assert.equal(pending.length, 2);
  assert.ok(pending.every((row) => row.authorName === "Alice" || row.authorEmail.startsWith("alice")));

  const accepted = await acceptSuggestion({
    groupId: loop2.groupId,
    suggestionId: pending[0].id,
    text: "What's everyone reading this month?",
    at: new Date("2026-02-01T00:00:00Z"),
  });
  assert.deepEqual(accepted, { ok: true });
  const [question] = await rows<{ text: string; created_by_membership_id: string }>(
    "select text, created_by_membership_id from questions where text like '%month%'",
  );
  assert.equal(question.created_by_membership_id, alice.id);

  assert.equal((await acceptSuggestion({ groupId: loop2.groupId, suggestionId: pending[0].id, text: "again", at: new Date() })).ok, false);
  assert.equal((await declineSuggestion({ groupId: loop2.groupId, suggestionId: pending[0].id, at: new Date() })).ok, false);

  assert.deepEqual(await declineSuggestion({ groupId: loop2.groupId, suggestionId: pending[1].id, at: new Date("2026-02-02T00:00:00Z") }), { ok: true });
  assert.equal((await pendingSuggestions(loop2.groupId)).length, 0);

  // A request that belongs to another loop stays unknown.
  const stray = await acceptSuggestion({ groupId: "00000000-0000-4000-8000-000000000000", suggestionId: pending[1].id, text: "x", at: new Date() });
  assert.equal(stray.ok, false);

  // Blank or oversized wording is refused before the lookup.
  assert.equal((await acceptSuggestion({ groupId: loop2.groupId, suggestionId: "00000000-0000-4000-8000-000000000000", text: "  ", at: new Date() })).ok, false);
  assert.equal((await acceptSuggestion({ groupId: loop2.groupId, suggestionId: "00000000-0000-4000-8000-000000000000", text: LONG, at: new Date() })).ok, false);
});

test("credits carry the author into a delivered issue, or drop them", async () => {
  const loop = await seedLoop();
  const alice = await memberOf(loop);
  await createSuggestion({ token: alice.token, text: "First", authorDisplay: "name" });
  await createSuggestion({ token: alice.token, text: "Second", authorDisplay: "anonymous" });

  const [firstSuggestion] = await rows<{ id: string }>("select id from question_suggestions where text = 'First'");
  const [secondSuggestion] = await rows<{ id: string }>("select id from question_suggestions where text = 'Second'");
  await acceptSuggestion({ groupId: loop.groupId, suggestionId: firstSuggestion.id, text: "First", at: new Date() });
  await acceptSuggestion({ groupId: loop.groupId, suggestionId: secondSuggestion.id, text: "Second", at: new Date() });
  const [first] = await rows<{ id: string }>("select id from questions where text = 'First'");
  const [second] = await rows<{ id: string }>("select id from questions where text = 'Second'");

  const credits = await suggestionCreditsForQuestions(loop.groupId, [first.id, second.id]);
  assert.equal(credits.get(first.id), "Alice");
  assert.equal(credits.has(second.id), false);
  assert.equal((await suggestionCreditsForQuestions(loop.groupId, [])).size, 0);
});

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetDatabase, rows, seedLoop, setupDatabase } from "../support/app.ts";
import {
  FEEDBACK_HOURLY_LIMIT,
  FEEDBACK_HOURLY_LIMIT_ANONYMOUS,
  FEEDBACK_MAX_LENGTH,
  submitFeedback,
} from "../../src/lib/feedback.ts";
import { AFTER_FIRST_SLOT } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

const note = (over: Partial<Parameters<typeof submitFeedback>[0]> = {}) => ({
  message: "The save button does nothing",
  path: "/g/abc",
  userAgent: "TestBrowser/1.0",
  viewport: "390×844",
  ...over,
});

type Stored = {
  message: string;
  path: string;
  user_id: string | null;
  membership_id: string | null;
  sender_name: string | null;
  sender_email: string | null;
  viewport: string | null;
};
async function ownerSession() {
  const [owner] = await rows<{ id: string }>(
    "insert into users (email, name) values ('owner@friendloop.test', 'Olive') returning id",
  );
  return { id: owner.id, name: "Olive", email: "owner@friendloop.test" };
}
const stored = () => rows<Stored>("select * from feedback order by created_at");

test("a stranger can send a note, and it records no one", async () => {
  assert.deepEqual(await submitFeedback(note({ message: "  hello  " }), null), { ok: true });
  const [row] = await stored();
  assert.equal(row.message, "hello");
  assert.equal(row.path, "/g/abc");
  assert.equal(row.viewport, "390×844");
  assert.equal(`${row.user_id}/${row.membership_id}/${row.sender_email}`, "null/null/null");
});

test("empty and oversized notes are refused", async () => {
  assert.equal((await submitFeedback(note({ message: "   " }), null)).ok, false);
  const long = await submitFeedback(note({ message: "a".repeat(FEEDBACK_MAX_LENGTH + 1) }), null);
  assert.equal(long.ok === false && long.status, 400);
  assert.equal((await stored()).length, 0);
});

test("a signed-in person is named from their session", async () => {
  const session = await ownerSession();
  await submitFeedback(note(), session);
  const [row] = await stored();
  assert.equal(`${row.user_id}/${row.sender_name}/${row.sender_email}`, `${session.id}/Olive/owner@friendloop.test`);
  assert.equal(row.membership_id, null);
});

test("a reply link names its member, and the token never reaches the stored path", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await submitFeedback(note({ path: `/r/${alice.token}/suggest?x=1` }), null);
  const [row] = await stored();
  assert.equal(row.sender_email, alice.email);
  assert.notEqual(row.membership_id, null);
  assert.equal(row.path, "/r/…/suggest");
  assert.ok(!JSON.stringify(row).includes(alice.token));
});

test("a reply link that no longer works is treated as a stranger", async () => {
  await submitFeedback(note({ path: "/r/not-a-token" }), null);
  const [row] = await stored();
  assert.equal(row.membership_id, null);
});

test("too many notes in an hour are refused, per sender", async () => {
  const session = await ownerSession();
  for (let i = 0; i < FEEDBACK_HOURLY_LIMIT; i++) assert.equal((await submitFeedback(note(), session)).ok, true);
  const refused = await submitFeedback(note(), session);
  assert.equal(refused.ok === false && refused.status, 429);

  // Someone else is unaffected, and strangers have their own wider bucket.
  assert.equal((await submitFeedback(note(), null)).ok, true);
  for (let i = 1; i < FEEDBACK_HOURLY_LIMIT_ANONYMOUS; i++) await submitFeedback(note(), null);
  const strangerRefused = await submitFeedback(note(), null);
  assert.equal(strangerRefused.ok === false && strangerRefused.status, 429);
});

test("a member with a reply link is limited by membership", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  for (let i = 0; i < FEEDBACK_HOURLY_LIMIT; i++) await submitFeedback(note({ path: `/r/${alice.token}` }), null);
  const refused = await submitFeedback(note({ path: `/r/${alice.token}` }), null);
  assert.equal(refused.ok === false && refused.status, 429);
});

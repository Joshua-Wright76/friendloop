import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sweep } from "../../src/lib/sweep.ts";
import { nudgeStragglers } from "../../src/lib/notify.ts";
import { resolveToken, saveReminderPreferenceFor } from "../../src/lib/reply.ts";
import { resetDatabase, rows, seedLoop, seedOpenIssue, seedReplies, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, HOUR } from "../../e2e/support/clock.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  await resetDatabase();
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

setupDatabase();

const REMINDER_TIME = new Date(DELIVERY_DAY.getTime() - 24 * HOUR);

async function reminderRecipients(): Promise<string[]> {
  const mail = await rows<{ to: string }>("select \"to\" from outbox where kind = 'reminder' order by \"to\"");
  return mail.map((row) => row.to);
}

test("everyone starts with reminders on", async () => {
  const loop = await seedLoop();
  const people = await rows<{ reminder_preference: string }>(
    "select reminder_preference from memberships where group_id = $1",
    [loop.groupId],
  );
  assert.ok(people.length > 0);
  assert.ok(people.every((person) => person.reminder_preference === "all"));
});

test("the loop's reminder skips anyone switched off; an old 'last only' choice counts as on", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  assert.deepEqual(await saveReminderPreferenceFor({ token: alice.token, preference: "none" }), {
    ok: true,
    savedAt: AFTER_FIRST_SLOT.toISOString(),
  });
  await rows("update memberships set reminder_preference = 'last' where id = $1", [bob.id]);

  const report = await sweep({ at: REMINDER_TIME });
  assert.equal(report.reminded, 2, "owner (on) and bob (stored 'last', which is on); alice switched hers off");
  assert.deepEqual(await reminderRecipients(), ["bob@friendloop.test", "owner@friendloop.test"]);

  // Rerunning, or running later, never sends another — for anyone.
  assert.equal((await sweep({ at: REMINDER_TIME })).reminded, 0);
  assert.equal((await sweep({ at: new Date(REMINDER_TIME.getTime() + HOUR) })).reminded, 0);
  assert.equal((await reminderRecipients()).length, 2);
});

test("changing your mind before the reminder is respected, and after it changes nothing already sent", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  await saveReminderPreferenceFor({ token: bob.token, preference: "none" });
  await saveReminderPreferenceFor({ token: bob.token, preference: "all" });
  await sweep({ at: REMINDER_TIME });
  assert.ok((await reminderRecipients()).includes("bob@friendloop.test"));

  await saveReminderPreferenceFor({ token: bob.token, preference: "none" });
  assert.equal((await sweep({ at: new Date(REMINDER_TIME.getTime() + HOUR) })).reminded, 0);
  assert.equal(
    (await reminderRecipients()).filter((to) => to === "bob@friendloop.test").length,
    1,
    "the one already sent stays sent",
  );
});

test("the owner's nudge by hand reaches everyone who owes an answer, whatever they asked for", async () => {
  const loop = await seedLoop();
  const issue = await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await seedReplies({
    issueId: issue.issueId,
    membershipId: alice.id,
    answers: [{ text: "What made you laugh this week?", body: "Done." }],
  });
  await rows("update memberships set reminder_preference = 'none' where id = $1", [bob.id]);

  assert.equal(await nudgeStragglers(loop.groupId), 2, "owner and bob, who asked for no automatic reminders");
  assert.deepEqual(await reminderRecipients(), ["bob@friendloop.test", "owner@friendloop.test"]);
});

test("prompt and delivery emails ignore the preference", async () => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await rows("update memberships set reminder_preference = 'none' where id = $1", [bob.id]);

  await sweep({ at: AFTER_FIRST_SLOT });
  const prompts = await rows<{ to: string }>("select \"to\" from outbox where kind = 'prompt'");
  assert.ok(prompts.some((row) => row.to === "bob@friendloop.test"));
});

test("only a live contributor can set it, and only to on or off", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const bad = await saveReminderPreferenceFor({ token: alice.token, preference: "sometimes" });
  assert.deepEqual(bad.ok === false && bad.status, 400);
  const missing = await saveReminderPreferenceFor({ token: alice.token, preference: undefined });
  assert.equal(missing.ok, false);
  const boolean = await saveReminderPreferenceFor({ token: alice.token, preference: false });
  assert.equal(boolean.ok === false && boolean.status, 400);

  const stranger = await saveReminderPreferenceFor({ token: "nobody", preference: "none" });
  assert.equal(stranger.ok === false && stranger.status, 404);

  await rows("update memberships set participation = 'reader' where id = $1", [alice.id]);
  const reader = await saveReminderPreferenceFor({ token: alice.token, preference: "none" });
  assert.equal(reader.ok === false && reader.status, 403);

  await rows("update memberships set revoked_at = now() where id = $1", [bob.id]);
  const revoked = await saveReminderPreferenceFor({ token: bob.token, preference: "none" });
  assert.equal(revoked.ok === false && revoked.status, 404);

  const stored = await rows<{ email: string; reminder_preference: string }>(
    "select email, reminder_preference from memberships where group_id = $1 and email in ('alice@friendloop.test','bob@friendloop.test')",
    [loop.groupId],
  );
  assert.ok(stored.every((row) => row.reminder_preference === "all"), "nothing was written");
});

test("the switch writes only on or off, and is read back by the sheet", async () => {
  const loop = await seedLoop();
  await seedOpenIssue(loop, { openedAt: AFTER_FIRST_SLOT });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  await saveReminderPreferenceFor({ token: alice.token, preference: "none" });
  let context = await resolveToken(alice.token);
  assert.equal(context.state === "ok" && context.membership.reminderPreference, "none");

  // A page opened before the switch replaced the three choices may still send "last": it means on.
  assert.equal((await saveReminderPreferenceFor({ token: alice.token, preference: "last" })).ok, true);
  context = await resolveToken(alice.token);
  assert.equal(context.state === "ok" && context.membership.reminderPreference, "all");
});

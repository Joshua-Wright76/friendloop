import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  addQuestion,
  addQuestionTexts,
  archiveQuestion,
  backfillShareTokens,
  createLoop,
  deleteLoop,
  inviteExpired,
  inviteMembers,
  loopsForUser,
  loopUrl,
  membersOf,
  normalizeEmail,
  openIssueNow,
  parseEmails,
  removeMember,
  reorderQuestion,
  resendInvite,
  rotateShareLinks,
  setAccess,
  setParticipation,
  setPaused,
  toggleSkipNext,
  transferOwnership,
  updateLoopSettings,
  userById,
} from "../../src/lib/manage.ts";
import { outboxCount, rows, seedDeliveredIssue, seedLoop, setupDatabase } from "../support/app.ts";
import { AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, E2E_NOW } from "../../e2e/support/clock.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

beforeEach(async () => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

async function makeUser(email = "owner@friendloop.test"): Promise<string> {
  const [user] = await rows<{ id: string }>(
    "insert into users (email, name) values ($1, 'Owner') returning id",
    [email],
  );
  return user.id;
}

async function questionsOf(groupId: string) {
  return rows<{ id: string; text: string; position: number; active: boolean; skip_next: boolean }>(
    "select id, text, position, active, skip_next from questions where group_id = $1 order by position",
    [groupId],
  );
}


setupDatabase();

test("email parsing dedupes, normalizes, and drops non-addresses", () => {
  assert.deepEqual(
    parseEmails(" A@x.com, b@x.com;  a@x.com  not-an-email  C@X.com "),
    ["a@x.com", "b@x.com", "c@x.com"],
  );
  assert.deepEqual(parseEmails(""), []);
  assert.equal(normalizeEmail("  Q@X.COM "), "q@x.com");
});

test("creating a loop writes the owner membership and the questions in order", async () => {
  const userId = await makeUser();
  const groupId = await createLoop({
    ownerUserId: userId,
    ownerEmail: " Owner@Friendloop.Test ",
    ownerName: "Owner",
    name: "Friday Loop",
    mode: "group",
    timezone: "Europe/Amsterdam",
    promptWeekday: 5,
    promptHour: 9,
    cadenceWeeks: 1,
    questions: ["  First  ", "", "Second"],
    at: E2E_NOW,
  });

  const [group] = await rows<{ name: string; created_at: Date; window_days: number }>(
    "select name, created_at, window_days from groups where id = $1",
    [groupId],
  );
  assert.equal(group.name, "Friday Loop");
  assert.equal(new Date(group.created_at).toISOString(), E2E_NOW.toISOString());
  assert.equal(group.window_days, 7, "the schema default is the 7-day window");

  const [owner] = await rows<{ email: string; access: string; user_id: string; accepted_at: Date }>(
    "select email, access, user_id, accepted_at from memberships where group_id = $1",
    [groupId],
  );
  assert.equal(owner.email, "owner@friendloop.test");
  assert.equal(owner.access, "owner");
  assert.equal(owner.user_id, userId);
  assert.ok(owner.accepted_at);

  const questions = await questionsOf(groupId);
  assert.deepEqual(questions.map((question) => question.text), ["First", "Second"]);
});

test("creating a loop with no questions is allowed", async () => {
  const userId = await makeUser();
  const groupId = await createLoop({
    ownerUserId: userId,
    ownerEmail: "owner@friendloop.test",
    name: "Empty",
    mode: "group",
    timezone: "UTC",
    promptWeekday: 1,
    promptHour: 8,
    cadenceWeeks: 2,
    questions: ["   "],
    at: E2E_NOW,
  });
  assert.equal((await questionsOf(groupId)).length, 0);
});

test("inviting adds pending members, each with a token and an email", async () => {
  const loop = await seedLoop();
  const result = await inviteMembers({
    groupId: loop.groupId,
    emails: ["new1@friendloop.test, new2@friendloop.test"],
    participation: "contributor",
    actorName: "Sam",
    at: E2E_NOW,
    personalNote: "Bring stories.",
  });

  assert.deepEqual(result, { invited: 2, skipped: 0 });

  const invited = await rows<{ email: string; accepted_at: Date | null; reply_token: string }>(
    "select email, accepted_at, reply_token from memberships where email like 'new%' order by email",
  );
  assert.equal(invited.length, 2);
  assert.ok(invited.every((row) => row.accepted_at === null));
  assert.equal(new Set(invited.map((row) => row.reply_token)).size, 2);

  assert.equal(await outboxCount("invite:"), 2);
  const mail = await rows<{ html: string; to: string }>(
    "select html, \"to\" from outbox where kind = 'invite' order by \"to\"",
  );
  assert.ok(mail[0].html.includes("Bring stories."));
  assert.ok(mail[0].html.includes(invited[0].reply_token));
});

test("inviting somebody already in the loop skips them", async () => {
  const loop = await seedLoop();
  const result = await inviteMembers({
    groupId: loop.groupId,
    emails: ["alice@friendloop.test", "brand@new.test"],
    participation: "reader",
    actorName: "Sam",
    at: E2E_NOW,
  });
  assert.deepEqual(result, { invited: 1, skipped: 1 });

  const [added] = await rows<{ participation: string }>(
    "select participation from memberships where email = 'brand@new.test'",
  );
  assert.equal(added.participation, "reader");
});

test("re-inviting a removed address revives it with a fresh token", async () => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await removeMember(loop.groupId, bob.id, E2E_NOW);

  const result = await inviteMembers({
    groupId: loop.groupId,
    emails: ["bob@friendloop.test"],
    participation: "contributor",
    actorName: "Sam",
    at: E2E_NOW,
  });
  assert.deepEqual(result, { invited: 1, skipped: 0 });

  const [revived] = await rows<{ revoked_at: Date | null; reply_token: string; accepted_at: Date | null }>(
    "select revoked_at, reply_token, accepted_at from memberships where id = $1",
    [bob.id],
  );
  assert.equal(revived.revoked_at, null);
  assert.notEqual(revived.reply_token, bob.token);
  assert.equal(revived.accepted_at, null);
});

test("a from_you loop invites everybody as a reader", async () => {
  const loop = await seedLoop({ mode: "from_you" });
  await inviteMembers({
    groupId: loop.groupId,
    emails: ["reader@friendloop.test"],
    participation: "contributor",
    actorName: "Sam",
    at: E2E_NOW,
  });

  const [invited] = await rows<{ participation: string }>(
    "select participation from memberships where email = 'reader@friendloop.test'",
  );
  assert.equal(invited.participation, "reader");
});

test("inviting to a loop that no longer exists throws", async () => {
  await assert.rejects(
    inviteMembers({
      groupId: "00000000-0000-4000-8000-000000000000",
      emails: ["x@y.test"],
      participation: "contributor",
      actorName: "Sam",
      at: E2E_NOW,
    }),
    /not-found/,
  );
});

test("resending an invite mints a new dedupe key but keeps the token", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;

  assert.equal(await resendInvite({ groupId: loop.groupId, membershipId: alice.id, actorName: "Sam" }), true);
  assert.equal(await resendInvite({ groupId: loop.groupId, membershipId: alice.id, actorName: "Sam" }), true);
  assert.equal(await outboxCount(`invite:${alice.id}:`), 2, "each resend is its own email");

  const [membership] = await rows<{ reply_token: string }>(
    "select reply_token from memberships where id = $1",
    [alice.id],
  );
  assert.equal(membership.reply_token, alice.token, "the link people already have still works");
});

test("resending to somebody who does not exist, or was removed, is refused", async () => {
  const loop = await seedLoop();
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  assert.equal(
    await resendInvite({ groupId: loop.groupId, membershipId: "00000000-0000-4000-8000-000000000000", actorName: "Sam" }),
    false,
  );
  await removeMember(loop.groupId, bob.id, E2E_NOW);
  assert.equal(await resendInvite({ groupId: loop.groupId, membershipId: bob.id, actorName: "Sam" }), false);
});

test("removing a member revokes them, but never the owner", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const owner = loop.members.find((member) => member.access === "owner")!;

  assert.equal(await removeMember(loop.groupId, alice.id, E2E_NOW), true);
  assert.equal(await removeMember(loop.groupId, owner.id, E2E_NOW), false);
  assert.equal(
    await removeMember(loop.groupId, "00000000-0000-4000-8000-000000000000", E2E_NOW),
    false,
  );

  const [removed] = await rows<{ revoked_at: Date | null }>(
    "select revoked_at from memberships where id = $1",
    [alice.id],
  );
  assert.equal(new Date(removed.revoked_at!).toISOString(), E2E_NOW.toISOString());

  const [unchanged] = await rows<{ revoked_at: Date | null }>(
    "select revoked_at from memberships where id = $1",
    [owner.id],
  );
  assert.equal(unchanged.revoked_at, null);
});

test("participation can change, except for the owner and except in from_you", async () => {
  const group = await seedLoop();
  const reader = await seedLoop({ mode: "from_you", name: "From You" });
  const alice = group.members.find((member) => member.email.startsWith("alice"))!;
  const owner = group.members.find((member) => member.access === "owner")!;
  const fromYouAlice = reader.members.find((member) => member.email.startsWith("alice"))!;

  assert.equal(await setParticipation(group.groupId, alice.id, "reader"), true);
  assert.equal(await setParticipation(group.groupId, owner.id, "reader"), false);
  assert.equal(await setParticipation(reader.groupId, fromYouAlice.id, "contributor"), true);

  const [a, b] = await rows<{ email: string; participation: string }>(
    "select email, participation from memberships where id = any($1::uuid[]) order by email",
    [[alice.id, fromYouAlice.id]],
  );
  assert.equal(a.participation, "reader");
  assert.equal(b.participation, "reader", "from_you pins everybody else to reader");

  assert.equal(await setParticipation("00000000-0000-4000-8000-000000000000", alice.id, "reader"), false);
  assert.equal(await setParticipation(group.groupId, "00000000-0000-4000-8000-000000000000", "reader"), false);
});

test("access can change, but the owner's cannot", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const owner = loop.members.find((member) => member.access === "owner")!;

  assert.equal(await setAccess(loop.groupId, alice.id, "admin"), true);
  assert.equal(await setAccess(loop.groupId, owner.id, "member"), false);
  assert.equal(await setAccess(loop.groupId, "00000000-0000-4000-8000-000000000000", "admin"), false);

  const [row] = await rows<{ access: string }>("select access from memberships where id = $1", [alice.id]);
  assert.equal(row.access, "admin");
});

test("transferring ownership demotes the old owner and promotes the new one", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  const owner = loop.members.find((member) => member.access === "owner")!;
  await setParticipation(loop.groupId, alice.id, "reader");
  await setAccess(loop.groupId, alice.id, "admin");

  assert.equal(await transferOwnership(loop.groupId, owner.id, alice.id), true);

  const rowsAfter = await rows<{ id: string; access: string; participation: string }>(
    "select id, access, participation from memberships where id = any($1::uuid[])",
    [[owner.id, alice.id]],
  );
  const byId = new Map(rowsAfter.map((row) => [row.id, row]));
  assert.equal(byId.get(owner.id)!.access, "admin");
  assert.equal(byId.get(alice.id)!.access, "owner");
  assert.equal(byId.get(alice.id)!.participation, "contributor", "an owner writes");
});

test("adding a question appends it, and a blank one is refused", async () => {
  const loop = await seedLoop();
  const id = await addQuestion(loop.groupId, "  A new question?  ", E2E_NOW);
  assert.ok(id);

  const questions = await questionsOf(loop.groupId);
  assert.equal(questions.at(-1)!.text, "A new question?");
  assert.equal(questions.at(-1)!.position, 2);

  assert.equal(await addQuestion(loop.groupId, "   ", E2E_NOW), null);
});

test("adding library questions skips the ones already in the pool", async () => {
  const loop = await seedLoop();
  const added = await addQuestionTexts(
    loop.groupId,
    ["What made you laugh this week?", "A fresh one?", "A fresh one?"],
    E2E_NOW,
  );
  assert.equal(added, 1);

  const questions = await questionsOf(loop.groupId);
  assert.equal(questions.length, 3);
  assert.equal(questions.at(-1)!.text, "A fresh one?");

  assert.equal(await addQuestionTexts(loop.groupId, ["A fresh one?"], E2E_NOW), 0);
});

test("an archived question is not a duplicate when re-added", async () => {
  const loop = await seedLoop();
  const [first] = await questionsOf(loop.groupId);
  await archiveQuestion(loop.groupId, first.id, E2E_NOW);

  const added = await addQuestionTexts(loop.groupId, [first.text], E2E_NOW);
  assert.equal(added, 1);
});

test("reordering moves a question and reports a no-op honestly", async () => {
  const loop = await seedLoop();
  const before = await questionsOf(loop.groupId);

  assert.equal(await reorderQuestion(loop.groupId, before[1].id, 0), true);
  const after = await questionsOf(loop.groupId);
  assert.deepEqual(after.map((question) => question.id), [before[1].id, before[0].id]);

  assert.equal(await reorderQuestion(loop.groupId, before[1].id, 0), false);
  assert.equal(
    await reorderQuestion(loop.groupId, "00000000-0000-4000-8000-000000000000", 1),
    false,
  );
});

test("archiving hides a question from the pool and clears skip-next", async () => {
  const loop = await seedLoop();
  const [first] = await questionsOf(loop.groupId);
  await toggleSkipNext(loop.groupId, first.id);

  await archiveQuestion(loop.groupId, first.id, E2E_NOW);

  const [row] = await rows<{ active: boolean; archived_at: Date | null; skip_next: boolean }>(
    "select active, archived_at, skip_next from questions where id = $1",
    [first.id],
  );
  assert.equal(row.active, false);
  assert.equal(row.skip_next, false);
  assert.ok(row.archived_at);
});

test("skip-next toggles, and refuses an unknown question", async () => {
  const loop = await seedLoop();
  const [first] = await questionsOf(loop.groupId);

  assert.equal(await toggleSkipNext(loop.groupId, first.id), true);
  assert.equal((await questionsOf(loop.groupId))[0].skip_next, true);
  assert.equal(await toggleSkipNext(loop.groupId, first.id), true);
  assert.equal((await questionsOf(loop.groupId))[0].skip_next, false);
  assert.equal(await toggleSkipNext(loop.groupId, "00000000-0000-4000-8000-000000000000"), false);
});

test("turning sharing on backfills the rounds that already went out", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
  });
  assert.equal(
    (
      await rows<{ share_token: string | null }>("select share_token from issues where id = $1", [
        delivered.issueId,
      ])
    )[0].share_token,
    null,
  );

  await updateLoopSettings(loop.groupId, {
    name: "Renamed",
    timezone: "Asia/Tokyo",
    promptWeekday: 1,
    promptHour: 7,
    cadenceWeeks: 2,
    shareEnabled: true,
  });

  const [group] = await rows<{
    name: string;
    display_name: string;
    timezone: string;
    prompt_weekday: number;
    prompt_hour: number;
    cadence_weeks: number;
    share_enabled: boolean;
  }>("select name, display_name, timezone, prompt_weekday, prompt_hour, cadence_weeks, share_enabled from groups where id = $1", [
    loop.groupId,
  ]);
  assert.deepEqual(group, {
    name: "Renamed",
    display_name: "Renamed",
    timezone: "Asia/Tokyo",
    prompt_weekday: 1,
    prompt_hour: 7,
    cadence_weeks: 2,
    share_enabled: true,
  });

  const [issue] = await rows<{ share_token: string | null }>(
    "select share_token from issues where id = $1",
    [delivered.issueId],
  );
  assert.ok(issue.share_token, "the round that already went out gets a share link");
});

test("updating settings while sharing stays on does not mint new links", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
    shareToken: "existing-token",
  });

  await updateLoopSettings(loop.groupId, {
    name: "Friday Loop",
    timezone: "Europe/Amsterdam",
    promptWeekday: 5,
    promptHour: 9,
    cadenceWeeks: 1,
    shareEnabled: true,
  });

  const [issue] = await rows<{ share_token: string }>("select share_token from issues where id = $1", [
    delivered.issueId,
  ]);
  assert.equal(issue.share_token, "existing-token");
});

test("backfill and rotate only touch delivered rounds", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
    shareToken: "old-token",
  });
  await rows(
    `insert into issues (group_id, number, status, slot_at, opens_at, delivers_at)
     values ($1, 99, 'open', $2, $2, $2)`,
    [loop.groupId, E2E_NOW.toISOString()],
  );

  assert.equal(await backfillShareTokens(loop.groupId), 0, "nothing is missing");
  assert.equal(await rotateShareLinks(loop.groupId), 1, "only the delivered round");

  const [issue] = await rows<{ share_token: string }>("select share_token from issues where id = $1", [
    delivered.issueId,
  ]);
  assert.notEqual(issue.share_token, "old-token");
});

test("pausing stops the schedule; resuming starts it from that moment", async () => {
  const loop = await seedLoop();

  await setPaused(loop.groupId, true, E2E_NOW);
  const [paused] = await rows<{ paused_at: Date | null }>("select paused_at from groups where id = $1", [loop.groupId]);
  assert.equal(new Date(paused.paused_at!).toISOString(), E2E_NOW.toISOString());

  const resumedAt = new Date(E2E_NOW.getTime() + 5 * 24 * 60 * 60 * 1000);
  await setPaused(loop.groupId, false, resumedAt);
  const [resumed] = await rows<{ paused_at: Date | null; last_slot_at: Date | null }>(
    "select paused_at, last_slot_at from groups where id = $1",
    [loop.groupId],
  );
  assert.equal(resumed.paused_at, null);
  assert.equal(new Date(resumed.last_slot_at!).toISOString(), resumedAt.toISOString());
});

test("deleting a loop takes its issues, replies, and questions with it", async () => {
  const loop = await seedLoop();
  const delivered = await seedDeliveredIssue(loop, {
    deliveredAt: E2E_NOW,
    answers: [{ email: "alice@friendloop.test", body: "Something." }],
  });

  await deleteLoop(loop.groupId);

  for (const table of ["groups", "memberships", "questions", "issues", "issue_questions", "replies"]) {
    const key = table === "groups" ? "id" : "group_id";
    if (table === "issue_questions" || table === "replies") {
      const [row] = await rows<{ count: number }>(
        `select count(*)::int as count from ${table} where issue_id = $1`,
        [delivered.issueId],
      );
      assert.equal(row.count, 0, `${table} should be gone`);
      continue;
    }
    const [row] = await rows<{ count: number }>(`select count(*)::int as count from ${table} where ${key} = $1`, [
      loop.groupId,
    ]);
    assert.equal(row.count, 0, `${table} should be gone`);
  }
});

test("starting a round by hand opens it once", async () => {
  const loop = await seedLoop();

  const first = await openIssueNow(loop.groupId, E2E_NOW);
  assert.ok(first);
  assert.equal(first.number, 1);

  const [issue] = await rows<{ opens_at: Date; delivers_at: Date; status: string }>(
    "select opens_at, delivers_at, status from issues where id = $1",
    [first.issueId],
  );
  assert.equal(issue.status, "open");
  assert.equal(new Date(issue.delivers_at).getTime(), E2E_NOW.getTime() + 7 * 24 * 60 * 60 * 1000);

  assert.equal(await outboxCount("prompt:"), 3, "contributors are told");

  const again = await openIssueNow(loop.groupId, new Date(E2E_NOW.getTime() + 60_000));
  assert.equal(first.created, true);
  assert.deepEqual(
    again,
    { ...first, created: false },
    "the open round is returned, not a second one, and nothing new was sent",
  );
});

test("starting a round by hand is refused when it cannot be created", async () => {
  const loop = await seedLoop();
  assert.equal(await openIssueNow("00000000-0000-4000-8000-000000000000", E2E_NOW), null);

  // Same slot twice: the second insert conflicts and is reported as null.
  await rows(
    `insert into issues (group_id, number, status, slot_at, opens_at, delivers_at)
     values ($1, 50, 'delivered', $2, $2, $2)`,
    [loop.groupId, E2E_NOW.toISOString()],
  );
  assert.equal(await openIssueNow(loop.groupId, E2E_NOW), null);
});

test("members are listed owner-first and without the removed", async () => {
  const loop = await seedLoop();
  await setAccess(loop.groupId, loop.members[1].id, "admin");
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  await removeMember(loop.groupId, bob.id, E2E_NOW);

  const members = await membersOf(loop.groupId);
  assert.deepEqual(
    members.map((member) => member.email),
    ["owner@friendloop.test", "alice@friendloop.test"],
  );
  assert.equal(members[0].access, "owner");
  assert.equal(members[1].access, "admin");
});

test("a user can be read back by id", async () => {
  const userId = await makeUser("read@friendloop.test");
  const user = await userById(userId);
  assert.equal(user?.email, "read@friendloop.test");
  assert.equal(await userById("00000000-0000-4000-8000-000000000000"), null);
});

test("an invite expires after two weeks unless it was accepted", () => {
  const invitedAt = new Date(E2E_NOW.getTime() - 14 * 24 * 60 * 60 * 1000);
  assert.equal(inviteExpired(invitedAt, null, E2E_NOW), true);
  assert.equal(inviteExpired(invitedAt, E2E_NOW, E2E_NOW), false);
  assert.equal(inviteExpired(E2E_NOW, null, E2E_NOW), false);
});

test("the loop url and a user's loops are readable", async () => {
  const userId = await makeUser();
  const loop = await seedLoop();
  await rows("update memberships set user_id = $1 where id = $2", [userId, loop.members[0].id]);

  assert.equal(loopUrl(loop.groupId), `http://localhost:3100/g/${loop.groupId}`);
  assert.deepEqual(await loopsForUser(userId), [{ groupId: loop.groupId, access: "owner" }]);
  assert.deepEqual(await loopsForUser("00000000-0000-4000-8000-000000000000"), []);
});


test("send now takes the place of the next slot, and resuming doesn't bring it back", async () => {
  const loop = await seedLoop();
  const before = new Date(BEFORE_FIRST_SLOT);
  await openIssueNow(loop.groupId, before);

  const [group] = await rows<{ last_slot_at: string }>("select last_slot_at from groups where id = $1", [loop.groupId]);
  assert.ok(new Date(group.last_slot_at) > before, "the next slot is used up");

  await setPaused(loop.groupId, true, before);
  await setPaused(loop.groupId, false, before);
  const [resumed] = await rows<{ last_slot_at: string }>("select last_slot_at from groups where id = $1", [loop.groupId]);
  assert.equal(new Date(resumed.last_slot_at).getTime(), new Date(group.last_slot_at).getTime());

  assert.equal((await sweep({ at: AFTER_FIRST_SLOT })).opened, 0);
  const issues = await rows("select id from issues where group_id = $1", [loop.groupId]);
  assert.equal(issues.length, 1);
});

test("send now brings the loop's sections into the round", async () => {
  const loop = await seedLoop();
  await rows("insert into sections (group_id, kind, title, position) values ($1, 'standard', 'The potluck corner', 0)", [loop.groupId]);

  const opened = await openIssueNow(loop.groupId, E2E_NOW);
  const sections = await rows<{ title: string }>("select title from issue_sections where issue_id = $1", [opened!.issueId]);
  assert.deepEqual(sections.map((section) => section.title), ["The potluck corner"]);
});

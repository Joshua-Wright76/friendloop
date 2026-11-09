import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  inviteLinkToken,
  joinDestination,
  joinWithInvite,
  loopForInvite,
  placeIn,
  resetInviteLink,
} from "../../src/lib/invite-link.ts";
import { confirmMagicLink, confirmSignInCode, requestMagicLink } from "../../src/lib/auth.ts";
import { MAX_MEMBERS_PER_LOOP } from "../../src/lib/rate-limit.ts";
import { joinUrl } from "../../src/lib/urls.ts";
import { addMember, E2E_NOW, latestOutbox, rows, seedLoop, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy, copyPattern } from "@/lib/copy";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

async function newUser(email: string, name: string | null = null) {
  const [user] = await rows<{ id: string; email: string; name: string | null }>(
    "insert into users (email, name) values ($1, $2) returning id, email, name",
    [email, name],
  );
  return user;
}

const tokenIn = (html: string) => decodeURIComponent(/token=([A-Za-z0-9_%-]+)/.exec(html)![1]);
const codeIn = (body: string) =>
  [copy.emails.signIn.text, copy.emails.join.text].map((template) => copyPattern(template, { values: { code: /(\d{6})/ } }).exec(body)?.[1]).find(Boolean)!;

test("a loop has one invite link until it's reset, and a reset link stops working", async () => {
  const loop = await seedLoop({ members: [] });
  const first = await inviteLinkToken(loop.groupId);
  assert.equal(await inviteLinkToken(loop.groupId), first, "asking again gives the same link");
  assert.ok(first.length >= 20);
  assert.match(joinUrl(first), new RegExp(`^https?://[^/]+/join/${first}$`));

  const second = await resetInviteLink(loop.groupId, E2E_NOW);
  assert.notEqual(second, first);
  assert.equal(await inviteLinkToken(loop.groupId), second);
  assert.equal(await loopForInvite(first), null, "the old link leads nowhere");
  assert.equal((await loopForInvite(second))?.groupId, loop.groupId);
});

test("a reset works on a loop that never had a link", async () => {
  const loop = await seedLoop({ members: [] });
  const token = await resetInviteLink(loop.groupId, E2E_NOW);
  assert.equal(await inviteLinkToken(loop.groupId), token);
});

test("the join page learns the loop's name, who runs it, and how many are in", async () => {
  const loop = await seedLoop({ name: "Book Club", members: [{ email: "a@friendloop.test" }] });
  const found = await loopForInvite(await inviteLinkToken(loop.groupId));
  assert.ok(found);
  assert.equal(found.groupName, "Book Club");
  assert.equal(found.group.id, loop.groupId);
  assert.equal(found.ownerName, "Sam");
  assert.equal(found.people, 2);
  assert.equal(found.full, false);

  assert.equal(await loopForInvite(""), null);
  assert.equal(await loopForInvite("nope"), null);
});

test("an owner with no name is shown by their email handle, and a loop with no owner by its own name", async () => {
  const unnamed = await seedLoop({ owner: { email: "kai@friendloop.test", name: undefined }, members: [] });
  await rows("update memberships set name = null where group_id = $1", [unnamed.groupId]);
  assert.equal((await loopForInvite(await inviteLinkToken(unnamed.groupId)))?.ownerName, "kai");

  const ownerless = await seedLoop({ name: "Orphans", owner: null, members: [] });
  assert.equal((await loopForInvite(await inviteLinkToken(ownerless.groupId)))?.ownerName, "Orphans");
});

test("joining puts a signed-in person in the loop as someone who answers", async () => {
  const loop = await seedLoop({ members: [] });
  const token = await inviteLinkToken(loop.groupId);
  const user = await newUser("nia@friendloop.test", "Nia");

  const outcome = await joinWithInvite({ token, user, at: E2E_NOW });
  assert.deepEqual(outcome, { status: "joined", groupId: loop.groupId });

  const [member] = await rows<{ user_id: string; email: string; name: string; access: string; participation: string; accepted_at: Date; reply_token: string }>(
    "select user_id, email, name, access, participation, accepted_at, reply_token from memberships where email = $1",
    [user.email],
  );
  assert.equal(member.user_id, user.id);
  assert.equal(member.name, "Nia");
  assert.equal(member.access, "member");
  assert.equal(member.participation, "contributor");
  assert.equal(new Date(member.accepted_at).getTime(), E2E_NOW.getTime());
  assert.ok(member.reply_token.length > 20, "they get a reply link like everyone else");

  assert.deepEqual(await joinWithInvite({ token, user, at: E2E_NOW }), { status: "already", groupId: loop.groupId });
  assert.equal(await placeIn(loop.groupId, user), "in");
});

test("someone invited by email who opens the link is already in", async () => {
  const loop = await seedLoop({ members: [] });
  await addMember(loop, { email: "ivy@friendloop.test", accepted: false });
  const user = await newUser("ivy@friendloop.test");
  assert.equal(await placeIn(loop.groupId, user), "in");
  assert.equal((await joinWithInvite({ token: await inviteLinkToken(loop.groupId), user, at: E2E_NOW })).status, "already");
});

test("the link doesn't bring back someone the owner removed", async () => {
  const loop = await seedLoop({ members: [] });
  const removed = await addMember(loop, { email: "gone@friendloop.test" });
  await rows("update memberships set revoked_at = now() where id = $1", [removed.id]);
  const user = await newUser("gone@friendloop.test");

  assert.equal(await placeIn(loop.groupId, user), "removed");
  assert.deepEqual(
    await joinWithInvite({ token: await inviteLinkToken(loop.groupId), user, at: E2E_NOW }),
    { status: "removed", groupId: loop.groupId },
  );
});

test("a full loop takes nobody else, and a reset link takes nobody", async () => {
  const loop = await seedLoop({ members: [] });
  await rows(
    `insert into memberships (group_id, email, reply_token)
     select $1, 'p' || n || '@friendloop.test', 'token-' || n from generate_series(1, $2::int) n`,
    [loop.groupId, MAX_MEMBERS_PER_LOOP - 1],
  );
  const token = await inviteLinkToken(loop.groupId);
  assert.equal((await loopForInvite(token))?.full, true);
  const user = await newUser("late@friendloop.test");
  assert.deepEqual(await joinWithInvite({ token, user, at: E2E_NOW }), { status: "full", groupId: loop.groupId });

  await resetInviteLink(loop.groupId, E2E_NOW);
  assert.deepEqual(await joinWithInvite({ token, user, at: E2E_NOW }), { status: "gone" });
});

test("after a join, people go into the loop, or back to the link's page to hear what stopped them", () => {
  assert.equal(joinDestination("t", { status: "joined", groupId: "g" }), "/g/g?welcome=joined");
  assert.equal(joinDestination("t", { status: "already", groupId: "g" }), "/g/g");
  assert.equal(joinDestination("t/x", { status: "full", groupId: "g" }), "/join/t%2Fx");
  assert.equal(joinDestination("t", { status: "gone" }), "/join/t");
});

test("asking from the link sends a join email, and using its link joins the loop", async () => {
  const loop = await seedLoop({ name: "Book Club", members: [] });
  const token = await inviteLinkToken(loop.groupId);

  await requestMagicLink("New@friendloop.test", { joinToken: token });
  const mail = await latestOutbox("signin:");
  assert.match(mail.subject, copyPattern(copy.emails.join.subject, { values: { groupName: "Book Club", code: /\d{6}/ }, start: true, end: true }));
  const [link] = await rows<{ join_token: string }>("select join_token from magic_links");
  assert.equal(link.join_token, token);

  const result = await confirmMagicLink(tokenIn(mail.html), { name: "Nia" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.join, { joinToken: token, outcome: { status: "joined", groupId: loop.groupId } });
  const [member] = await rows<{ name: string; user_id: string }>("select name, user_id from memberships where email = 'new@friendloop.test'");
  assert.equal(member.name, "Nia");
  assert.equal(member.user_id, result.user.id);
});

test("a plain sign-in joins nothing, and a link asked for from a reset invite is a plain sign-in", async () => {
  await requestMagicLink("plain@friendloop.test");
  const plain = await confirmMagicLink(tokenIn((await latestOutbox("signin:")).html));
  assert.equal(plain.ok && plain.join, undefined);

  const loop = await seedLoop({ members: [] });
  const old = await inviteLinkToken(loop.groupId);
  await resetInviteLink(loop.groupId, E2E_NOW);
  await requestMagicLink("late@friendloop.test", { joinToken: old });
  const mail = await latestOutbox("signin:");
  assert.match(mail.subject, copyPattern(copy.emails.signIn.heading, { start: true }));
  const [link] = await rows<{ join_token: string | null }>("select join_token from magic_links where email = 'late@friendloop.test'");
  assert.equal(link.join_token, null);
});

test("a link reset between asking and confirming signs them in without joining", async () => {
  const loop = await seedLoop({ members: [] });
  const token = await inviteLinkToken(loop.groupId);
  await requestMagicLink("slow@friendloop.test", { joinToken: token });
  await resetInviteLink(loop.groupId, E2E_NOW);

  const result = await confirmMagicLink(tokenIn((await latestOutbox("signin:")).html));
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.join, { joinToken: token, outcome: { status: "gone" } });
  assert.equal((await rows("select 1 from memberships where email = 'slow@friendloop.test'")).length, 0);
});

test("the code joins too: a returning person at once, someone new after the name step", async () => {
  const loop = await seedLoop({ members: [] });
  const token = await inviteLinkToken(loop.groupId);

  await newUser("back@friendloop.test", "Back");
  await requestMagicLink("back@friendloop.test", { joinToken: token });
  const back = await confirmSignInCode("back@friendloop.test", codeIn((await latestOutbox("signin:")).text));
  assert.equal(back.ok, true);
  assert.deepEqual(back.ok === true && back.join, { joinToken: token, outcome: { status: "joined", groupId: loop.groupId } });

  await requestMagicLink("fresh@friendloop.test", { joinToken: token });
  const fresh = await confirmSignInCode("fresh@friendloop.test", codeIn((await latestOutbox("signin:")).text));
  assert.equal(fresh.ok, "name");
  if (fresh.ok !== "name") return;
  const named = await confirmMagicLink(fresh.token, { name: "Fresh" });
  assert.deepEqual(named.ok && named.join, { joinToken: token, outcome: { status: "joined", groupId: loop.groupId } });
});

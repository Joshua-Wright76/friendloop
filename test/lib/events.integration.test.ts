import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues, memberships, questions } from "@/db/schema";
import { placeDatedItems } from "../../src/lib/events.ts";
import { createItem, stopAsking, updateItem, type ItemInput } from "../../src/lib/ask-items.ts";
import { questionsPageOf } from "../../src/lib/questions-page.ts";
import { removeMember } from "../../src/lib/manage.ts";
import { saveDraftFor, sheetFor } from "../../src/lib/reply.ts";
import { insertPoolItem } from "../../src/lib/round-questions.ts";
import { openRound } from "../../src/lib/rounds.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, rows, seedLoop, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";
import { copy, text as copyText } from "@/lib/copy";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

// seedLoop: Friday 09:00 Amsterdam, weekly. The first issue opens 2 Jan 2026 and
// covers 2 Jan through 9 Jan; the second opens on the 9th.
const BEFORE_ANY_ISSUE = new Date("2026-01-01T12:00:00Z");

type DateForm = { kind: "once" | "birthday"; title: string; emoji: string; date: string; membershipId: string | null };

/** What the add card or a row's editor sends for an item on a date. */
function dateItem(input: DateForm): ItemInput {
  return {
    text: input.title, format: "written", frequency: "on_date", pollOptions: [], pollMultiple: false,
    emoji: input.emoji, description: "", adminOnly: false,
    dateKind: input.kind, date: input.date, aboutMembershipId: input.membershipId,
  };
}

/** Add a date the way the Questions page's add card does. */
async function createEvent(input: DateForm & { group: typeof groups.$inferSelect; at: Date }) {
  const result = await createItem({ group: input.group, item: dateItem(input), thisRound: false, at: input.at });
  return result.ok ? { ok: true } : result;
}

/** Save a date's editor; its kind stays what it was. */
async function updateEvent(input: Omit<DateForm, "kind"> & { eventId: string; group: typeof groups.$inferSelect; at: Date }) {
  const [existing] = await db.select().from(questions).where(eq(questions.id, input.eventId));
  const kind = existing?.dateKind === "birthday" ? "birthday" : "once";
  const result = await updateItem({ group: input.group, questionId: input.eventId, item: dateItem({ ...input, kind }), at: input.at });
  return result.ok ? { ok: true } : result;
}

/** The page's "On a date" list for its owner. */
async function eventsOf(group: Pick<typeof groups.$inferSelect, "id"> & { timezone?: string }, at: Date) {
  const [full] = await db.select().from(groups).where(eq(groups.id, group.id));
  const [owner] = await db.select().from(memberships).where(and(eq(memberships.groupId, group.id), eq(memberships.access, "owner")));
  return (await questionsPageOf({ group: full, viewer: owner, at })).dated;
}

async function groupOf(groupId: string) {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  return group;
}

async function aliceOf(loop: Awaited<ReturnType<typeof seedLoop>>) {
  return loop.members.find((member) => member.email.startsWith("alice"))!;
}

async function addBirthday(loop: Awaited<ReturnType<typeof seedLoop>>, date: string, who = "alice") {
  const member = loop.members.find((candidate) => candidate.email.startsWith(who))!;
  return createEvent({
    kind: "birthday",
    title: "",
    emoji: "",
    date,
    membershipId: member.id,
    group: await groupOf(loop.groupId),
    at: BEFORE_ANY_ISSUE,
  });
}

/** A loop's dates: pool items asked on a day. */
async function datedItems() {
  return db.select().from(questions).where(eq(questions.frequency, "on_date")).orderBy(asc(questions.createdAt));
}

/** The cards rounds made of them. */
async function eventSections() {
  return rows<{ title: string; emoji: string | null; description: string | null; event_id: string | null; event_date: string | null; number: number; about: string | null }>(
    `select q.text as title, q.emoji, q.description, q.question_id as event_id, q.occurrence_date::text as event_date,
            i.number, q.about_membership_id as about
       from issue_questions q join issues i on i.id = q.issue_id
      where q.occurrence_date is not null
      order by i.number asc, q.position asc`,
  );
}

test("a birthday inside the window becomes a card titled with the member's name, and about them", async () => {
  const loop = await seedLoop();
  assert.deepEqual(await addBirthday(loop, "1990-01-06"), { ok: true });
  const [item] = await datedItems();
  assert.equal(item.text, "", "a birthday is titled when a round opens");
  assert.equal(item.active, false, "code from before the switch never asks a date");

  await sweep({ at: AFTER_FIRST_SLOT });
  const found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].title, copyText(copy.events.birthdayRow, { name: "Alice" }));
  assert.equal(found[0].about, (await aliceOf(loop)).id);
  assert.equal(found[0].emoji, "🎉");
  assert.equal(found[0].event_date, "2026-01-06");
  assert.match(found[0].description ?? "", /Alice/);
});

test("an event outside every window is not placed in this issue", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-02-14");
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await eventSections()).length, 0);
});

test("the delivery day belongs to the issue that delivers it, and the next issue does not repeat it", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-09");
  await sweep({ at: AFTER_FIRST_SLOT });
  await sweep({ at: DELIVERY_DAY });
  const found = await eventSections();
  assert.deepEqual(found.map((row) => row.number), [1]);
});

test("a birthday lands in exactly one issue a year, however many weekly issues open", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-20");
  for (let week = 0; week < 8; week += 1) {
    // Nobody answers, so the round carries over and, in time, pauses the loop; keep it going.
    await db.update(groups).set({ pausedAt: null }).where(eq(groups.id, loop.groupId));
    await sweep({ at: new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * 24 * 3600 * 1000) });
  }
  const found = await eventSections();
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from issues"))[0].count >= 2, true);
  assert.equal(found.length, 1);
  assert.equal(found[0].event_date, "2026-01-20");
});

test("repeating the snapshot for the same issue never doubles a section", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string; opens_at: Date; delivers_at: Date }>("select id, opens_at, delivers_at from issues");
  const again = await placeDatedItems({
    group: await groupOf(loop.groupId),
    issueId: issue.id,
    opensAt: issue.opens_at,
    deliversAt: issue.delivers_at,
  });
  assert.equal(again, 0);
  assert.equal((await eventSections()).length, 1);
});

test("a one-time event is placed once and titled as given", async () => {
  const loop = await seedLoop();
  const result = await createEvent({
    kind: "once",
    title: "  The housewarming ",
    emoji: "🏡",
    date: "2026-01-07",
    membershipId: null,
    group: await groupOf(loop.groupId),
    at: BEFORE_ANY_ISSUE,
  });
  assert.deepEqual(result, { ok: true });
  await sweep({ at: AFTER_FIRST_SLOT });
  const found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "The housewarming");
  assert.equal(found[0].emoji, "🏡");
  assert.equal(found[0].about, null, "only a birthday is about someone");
});

test("with a window shorter than the cadence, a date in the gap still lands in the open issue", async () => {
  const loop = await seedLoop({ cadenceWeeks: 2 });
  await db.update(groups).set({ windowDays: 7 }).where(eq(groups.id, loop.groupId));
  // Delivery is 9 Jan; the next issue opens 16 Jan. The 13th falls in the gap.
  await addBirthday(loop, "1990-01-13");
  await sweep({ at: AFTER_FIRST_SLOT });
  const found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].event_date, "2026-01-13");
});

test("editing or removing a date, or renaming the member, never rewrites an issue", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });

  const [event] = await datedItems();
  const alice = await aliceOf(loop);
  await db.update(memberships).set({ name: "Alicia" }).where(eq(memberships.id, alice.id));
  await updateEvent({
    eventId: event.id,
    date: "1990-05-05",
    title: "",
    emoji: "🎈",
    membershipId: alice.id,
    group: await groupOf(loop.groupId),
    at: AFTER_FIRST_SLOT,
  });
  let found = await eventSections();
  assert.equal(found[0].title, copyText(copy.events.birthdayRow, { name: "Alice" }));
  assert.equal(found[0].emoji, "🎉");
  assert.equal(found[0].event_date, "2026-01-06");

  // Its pool row gone altogether (stopping leaves the row; erasure is what deletes one).
  await db.delete(questions).where(eq(questions.id, event.id));
  found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].title, copyText(copy.events.birthdayRow, { name: "Alice" }));
  assert.equal(found[0].event_id, null);
});

test("a birthday whose person has left the loop is skipped", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await removeMember(loop.groupId, (await aliceOf(loop)).id, AFTER_FIRST_SLOT);
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await eventSections()).length, 0);
  assert.deepEqual(await eventsOf({ id: loop.groupId, timezone: "Europe/Amsterdam" }, AFTER_FIRST_SLOT), []);
});

test("a paused loop opens nothing, so nothing is placed", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await db.update(groups).set({ pausedAt: new Date("2025-12-30T00:00:00Z") }).where(eq(groups.id, loop.groupId));
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await eventSections()).length, 0);
});

test("a manual round picks up events in its window too", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-04");
  const opened = await openRound({ groupId: loop.groupId, at: AFTER_FIRST_SLOT, prompt: false });
  assert.ok(opened);
  assert.equal((await eventSections()).length, 1);
});

test("an event added while a round is open joins that round when its date is inside", async () => {
  const loop = await seedLoop();
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await eventSections()).length, 0);

  await addBirthday(loop, "1990-01-07");
  await addBirthday(loop, "1990-03-01", "bob");
  const found = await eventSections();
  assert.deepEqual(found.map((row) => row.title), [copyText(copy.events.birthdayRow, { name: "Alice" })]);

  // A round asks an item once: moving the date to another day in the same round
  // keeps the card it already has, as it was.
  const [event] = await db.select().from(questions).where(and(eq(questions.frequency, "on_date"), eq(questions.day, 7)));
  await updateEvent({
    eventId: event.id,
    date: "1990-01-08",
    title: "",
    emoji: "",
    membershipId: event.aboutMembershipId,
    group: await groupOf(loop.groupId),
    at: AFTER_FIRST_SLOT,
  });
  assert.deepEqual((await eventSections()).map((row) => row.event_date), ["2026-01-07"]);
});

test("a birthday card is answered on the reply sheet like any question and delivers with the round", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const sheet = await sheetFor(bob.token);
  const card = sheet!.questions.find((item) => item.text === copyText(copy.events.birthdayRow, { name: "Alice" }))!;
  assert.equal(card.format, "written");
  assert.equal(card.emoji, "🎉");

  const saved = await saveDraftFor({ token: bob.token, issueQuestionId: card.id, body: "Happy birthday, Alice!" });
  assert.equal(saved.ok, true);

  const delivered = await sweep({ at: DELIVERY_DAY });
  assert.equal(delivered.delivered, 1);
  const [email] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' limit 1");
  assert.ok(email.html.includes("Alice&#39;s birthday") || email.html.includes(copyText(copy.events.birthdayRow, { name: "Alice" })));
  assert.ok(email.html.includes("Happy birthday, Alice!"));
});

test("the birthday person never sees or fills in their own card", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-04");
  await sweep({ at: AFTER_FIRST_SLOT });
  const alice = await aliceOf(loop);
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  // Everyone else is asked; Alice isn't, so the surprise holds.
  const card = (await sheetFor(bob.token))!.questions.find((item) => item.text === copyText(copy.events.birthdayRow, { name: "Alice" }));
  assert.ok(card);
  assert.equal((await sheetFor(alice.token))!.questions.some((item) => item.id === card.id), false);

  // A hand-made request for the hidden card is refused like any unknown question.
  const refused = await saveDraftFor({ token: alice.token, issueQuestionId: card.id, body: "Me!" });
  assert.equal(refused.ok, false);
  assert.equal(refused.ok ? 0 : refused.status, 409);
});

test("the list is soonest first, finished one-time events last, with labels and dates", async () => {
  const loop = await seedLoop();
  const group = await groupOf(loop.groupId);
  const alice = await aliceOf(loop);
  await createEvent({ kind: "birthday", title: "", emoji: "🎂", date: "1990-03-09", membershipId: alice.id, group, at: BEFORE_ANY_ISSUE });
  await createEvent({ kind: "once", title: "Zebra party", emoji: "", date: "2026-01-20", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  await createEvent({ kind: "once", title: "Aardvark party", emoji: "", date: "2026-01-05", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  await db.update(memberships).set({ name: null }).where(eq(memberships.id, alice.id));

  const list = await eventsOf(group, new Date("2026-01-10T12:00:00Z"));
  assert.deepEqual(list.map((item) => item.label), ["Zebra party", copyText(copy.events.birthdayRow, { name: "alice" }), "Aardvark party"]);
  assert.equal(list[0].nextLabel, "Tue, Jan 20");
  assert.equal(list[1].nextDate, "2026-03-09");
  assert.equal(list[1].inputDate, "2026-03-09");
  assert.equal(list[2].nextDate, null);
  assert.equal(list[2].nextLabel, null);

  // Two finished events order by name.
  await createEvent({ kind: "once", title: "Another one", emoji: "", date: "2026-01-02", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  const later = await eventsOf(group, new Date("2026-02-01T12:00:00Z"));
  assert.deepEqual(later.map((item) => item.label), [copyText(copy.events.birthdayRow, { name: "alice" }), "Aardvark party", "Another one", "Zebra party"]);
});

test("an event form is checked against the loop", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  const group = await groupOf(loop.groupId);
  const at = AFTER_FIRST_SLOT;
  const alice = await aliceOf(loop);
  const base = { kind: "once" as const, emoji: "", membershipId: null, group, at };

  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "soon" }), { ok: false, code: "date" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2026-02-30" }), { ok: false, code: "date" });
  assert.deepEqual(await createEvent({ ...base, title: "   ", date: "2026-03-01" }), { ok: false, code: "text" });
  assert.deepEqual(await createEvent({ ...base, title: "x".repeat(201), date: "2026-03-01" }), { ok: false, code: "text" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2025-12-31" }), { ok: false, code: "pastDate" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2026-01-02" }), { ok: true });

  const bday = { ...base, kind: "birthday" as const, title: "" };
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01" }), { ok: false, code: "person" });
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01", membershipId: other.members[0]?.id ?? other.groupId }), { ok: false, code: "person" });
  await removeMember(loop.groupId, alice.id, AFTER_FIRST_SLOT);
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01", membershipId: alice.id }), { ok: false, code: "person" });
  assert.equal((await datedItems()).length, 1);

  // Leap day is a fine birthday.
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  assert.deepEqual(await createEvent({ ...bday, date: "1992-02-29", membershipId: bob.id }), { ok: true });
});

test("updating an event keeps its kind and refuses a stranger's event or a bad date", async () => {
  const loop = await seedLoop();
  const group = await groupOf(loop.groupId);
  await createEvent({ kind: "once", title: "Party", emoji: "", date: "2026-03-01", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  const [event] = await datedItems();
  const input = { title: "Bigger party", emoji: "🎈", date: "2026-03-02", membershipId: null, group, at: BEFORE_ANY_ISSUE };

  assert.deepEqual(await updateEvent({ ...input, eventId: event.id }), { ok: true });
  const [saved] = await datedItems();
  assert.equal(saved.text, "Bigger party");
  assert.equal(saved.day, 2);
  assert.equal(saved.dateKind, "once");

  // Another loop's item, or one that is gone, is refused.
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  assert.deepEqual(await updateEvent({ ...input, group: await groupOf(other.groupId), eventId: event.id }), { ok: false, code: "gone" });
  assert.deepEqual(await updateEvent({ ...input, eventId: "00000000-0000-4000-8000-000000000000" }), { ok: false, code: "gone" });
  assert.deepEqual(await updateEvent({ ...input, eventId: event.id, date: "nope" }), { ok: false, code: "date" });
  // A date that has already passed is fine to keep editing.
  assert.deepEqual(await updateEvent({ ...input, eventId: event.id, date: "2020-01-01" }), { ok: true });
});

test("stopping a date only works inside its own loop", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  await createEvent({ kind: "once", title: "Party", emoji: "", date: "2026-03-01", membershipId: null, group: await groupOf(loop.groupId), at: BEFORE_ANY_ISSUE });
  const [event] = await datedItems();

  assert.equal(await stopAsking(other.groupId, event.id, AFTER_FIRST_SLOT), null);
  assert.equal((await datedItems())[0].archivedAt, null);
  assert.equal(await stopAsking(loop.groupId, event.id, AFTER_FIRST_SLOT), "absent", "stopped; it was in no open round");
  assert.equal(await stopAsking(loop.groupId, event.id, AFTER_FIRST_SLOT), null, "already stopped");
  assert.deepEqual(await eventsOf({ id: loop.groupId }, AFTER_FIRST_SLOT), []);
});

test("a birthday row with no person yet to celebrate places nothing", async () => {
  const loop = await seedLoop();
  await db.insert(questions).values({
    groupId: loop.groupId, text: "", frequency: "on_date", format: "written", active: false, dateKind: "birthday", month: 1, day: 6, aboutMembershipId: null,
  });
  await sweep({ at: AFTER_FIRST_SLOT });
  assert.equal((await eventSections()).length, 0);
});

test("the same birthday comes back the next year as a new section in a new issue", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });

  const group = await groupOf(loop.groupId);
  const opensAt = new Date("2027-01-01T08:00:00Z");
  const deliversAt = new Date("2027-01-08T08:00:00Z");
  const [next] = await db
    .insert(issues)
    .values({ groupId: group.id, number: 2, slotAt: opensAt, opensAt, deliversAt })
    .returning({ id: issues.id });
  const placed = await placeDatedItems({ group, issueId: next.id, opensAt, deliversAt });
  assert.equal(placed, 1);
  const found = await eventSections();
  assert.deepEqual(found.map((row) => row.event_date), ["2026-01-06", "2027-01-06"]);
});

test("several events in one window follow the calendar, after the questions and every-round items", async () => {
  const loop = await seedLoop({ questions: ["Q1"] });
  await insertPoolItem({
    groupId: loop.groupId, text: "The potluck corner", format: "written", frequency: "every_round", at: BEFORE_ANY_ISSUE,
  });
  // Added latest-date first on purpose.
  await addBirthday(loop, "1990-01-08", "bob");
  await addBirthday(loop, "1990-01-04", "alice");
  await sweep({ at: AFTER_FIRST_SLOT });

  const order = await rows<{ title: string }>("select text as title from issue_questions order by position asc");
  assert.deepEqual(order.map((row) => row.title), ["Q1", "The potluck corner", copyText(copy.events.birthdayRow, { name: "Alice" }), copyText(copy.events.birthdayRow, { name: "Bob" })]);
});

test("a stopped date is not placed, and a date's own words and emoji ride into the card", async () => {
  const loop = await seedLoop();
  const group = await groupOf(loop.groupId);
  await createEvent({ kind: "once", title: "Picnic", emoji: "", date: "2026-01-05", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  await createEvent({ kind: "once", title: "Stopped", emoji: "", date: "2026-01-06", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  await db.update(questions).set({ description: "Bring a blanket.", emoji: "🧺" }).where(eq(questions.text, "Picnic"));
  await db.update(questions).set({ archivedAt: BEFORE_ANY_ISSUE }).where(eq(questions.text, "Stopped"));
  await sweep({ at: AFTER_FIRST_SLOT });
  const found = await eventSections();
  assert.deepEqual(found.map((row) => [row.title, row.emoji, row.description]), [["Picnic", "🧺", "Bring a blanket."]]);
  assert.deepEqual((await eventsOf(group, AFTER_FIRST_SLOT)).map((item) => item.label), ["Picnic"]);
});

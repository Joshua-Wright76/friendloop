import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { events, groups, issues, memberships, sections } from "@/db/schema";
import { createEvent, deleteEvent, eventsOf, snapshotEventsForIssue, updateEvent } from "../../src/lib/events.ts";
import { openIssueNow, removeMember } from "../../src/lib/manage.ts";
import { sectionsForSheet, saveSectionTextFor } from "../../src/lib/sections.ts";
import { submitFor } from "../../src/lib/reply.ts";
import { sweep } from "../../src/lib/sweep.ts";
import { AFTER_FIRST_SLOT, DELIVERY_DAY, rows, seedLoop, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestHeaders({ "x-e2e-now": AFTER_FIRST_SLOT.toISOString() });
});

// seedLoop: Friday 09:00 Amsterdam, weekly. The first issue opens 2 Jan 2026 and
// covers 2 Jan through 9 Jan; the second opens on the 9th.
const BEFORE_ANY_ISSUE = new Date("2026-01-01T12:00:00Z");

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

async function eventSections() {
  return rows<{ title: string; emoji: string | null; description: string | null; event_id: string | null; event_date: string | null; number: number }>(
    `select s.title, s.emoji, s.description, s.event_id, s.event_date::text as event_date, i.number
       from issue_sections s join issues i on i.id = s.issue_id
      where s.event_date is not null or s.title like '%birthday%'
      order by i.number asc, s.position asc`,
  );
}

test("a birthday inside the window becomes a section titled with the member's name", async () => {
  const loop = await seedLoop();
  assert.deepEqual(await addBirthday(loop, "1990-01-06"), { ok: true });

  await sweep({ at: AFTER_FIRST_SLOT });
  const found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Alice's birthday");
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
    // Nobody answers, so each round is skipped and pauses the loop; keep it going.
    await db.update(groups).set({ pausedAt: null }).where(eq(groups.id, loop.groupId));
    await sweep({ at: new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * 24 * 3600 * 1000) });
  }
  const found = await eventSections();
  assert.equal((await rows<{ count: number }>("select count(*)::int as count from issues"))[0].count >= 4, true);
  assert.equal(found.length, 1);
  assert.equal(found[0].event_date, "2026-01-20");
});

test("repeating the snapshot for the same issue never doubles a section", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });
  const [issue] = await rows<{ id: string; opens_at: Date; delivers_at: Date }>("select id, opens_at, delivers_at from issues");
  const again = await snapshotEventsForIssue({
    group: await groupOf(loop.groupId),
    issueId: issue.id,
    opensAt: issue.opens_at,
    deliversAt: issue.delivers_at,
    nextSlotAt: issue.delivers_at,
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

test("editing or deleting an event, or renaming the member, never rewrites an issue", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });

  const [event] = await db.select().from(events);
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
  assert.equal(found[0].title, "Alice's birthday");
  assert.equal(found[0].emoji, "🎉");
  assert.equal(found[0].event_date, "2026-01-06");

  await deleteEvent({ groupId: loop.groupId, eventId: event.id });
  found = await eventSections();
  assert.equal(found.length, 1);
  assert.equal(found[0].title, "Alice's birthday");
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
  const opened = await openIssueNow(loop.groupId, AFTER_FIRST_SLOT);
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
  assert.deepEqual(found.map((row) => row.title), ["Alice's birthday"]);

  // Editing the date to another day in the window adds a section for that day, and
  // the earlier snapshot stays as it was.
  const [event] = await db.select().from(events).where(eq(events.day, 7));
  await updateEvent({
    eventId: event.id,
    date: "1990-01-08",
    title: "",
    emoji: "",
    membershipId: event.membershipId,
    group: await groupOf(loop.groupId),
    at: AFTER_FIRST_SLOT,
  });
  assert.equal((await eventSections()).length, 2);
});

test("an event section can be answered from the reply sheet and delivers with the round", async () => {
  const loop = await seedLoop();
  await addBirthday(loop, "1990-01-06");
  await sweep({ at: AFTER_FIRST_SLOT });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;

  const sheet = await sectionsForSheet(bob.token, (await rows<{ id: string }>("select id from issues"))[0].id);
  assert.equal(sheet.length, 1);
  assert.equal(sheet[0].title, "Alice's birthday");

  const saved = await saveSectionTextFor({ token: bob.token, issueSectionId: sheet[0].id, body: "Happy birthday, Alice!" });
  assert.equal(saved.ok, true);
  await submitFor(bob.token);

  const delivered = await sweep({ at: DELIVERY_DAY });
  assert.equal(delivered.delivered, 1);
  const [email] = await rows<{ html: string }>("select html from outbox where kind = 'delivery' limit 1");
  assert.ok(email.html.includes("Alice&#39;s birthday") || email.html.includes("Alice's birthday"));
  assert.ok(email.html.includes("Happy birthday, Alice!"));
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
  assert.deepEqual(list.map((item) => item.label), ["Zebra party", "alice's birthday", "Aardvark party"]);
  assert.equal(list[0].nextLabel, "Tue, Jan 20");
  assert.equal(list[1].nextDate, "2026-03-09");
  assert.equal(list[1].inputDate, "2026-03-09");
  assert.equal(list[2].nextDate, null);
  assert.equal(list[2].nextLabel, null);

  // Two finished events order by name.
  await createEvent({ kind: "once", title: "Another one", emoji: "", date: "2026-01-02", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  const later = await eventsOf(group, new Date("2026-02-01T12:00:00Z"));
  assert.deepEqual(later.map((item) => item.label), ["alice's birthday", "Aardvark party", "Another one", "Zebra party"]);
});

test("an event form is checked against the loop", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  const group = await groupOf(loop.groupId);
  const at = AFTER_FIRST_SLOT;
  const alice = await aliceOf(loop);
  const base = { kind: "once" as const, emoji: "", membershipId: null, group, at };

  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "soon" }), { ok: false, code: "invalid" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2026-02-30" }), { ok: false, code: "invalid" });
  assert.deepEqual(await createEvent({ ...base, title: "   ", date: "2026-03-01" }), { ok: false, code: "titleRequired" });
  assert.deepEqual(await createEvent({ ...base, title: "x".repeat(81), date: "2026-03-01" }), { ok: false, code: "titleRequired" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2025-12-31" }), { ok: false, code: "pastDate" });
  assert.deepEqual(await createEvent({ ...base, title: "Party", date: "2026-01-02" }), { ok: true });

  const bday = { ...base, kind: "birthday" as const, title: "" };
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01" }), { ok: false, code: "memberRequired" });
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01", membershipId: other.members[0]?.id ?? other.groupId }), { ok: false, code: "memberRequired" });
  await removeMember(loop.groupId, alice.id, AFTER_FIRST_SLOT);
  assert.deepEqual(await createEvent({ ...bday, date: "1990-03-01", membershipId: alice.id }), { ok: false, code: "memberRequired" });
  assert.equal((await db.select().from(events)).length, 1);

  // Leap day is a fine birthday.
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  assert.deepEqual(await createEvent({ ...bday, date: "1992-02-29", membershipId: bob.id }), { ok: true });
});

test("updating an event keeps its kind and refuses a stranger's event or a bad date", async () => {
  const loop = await seedLoop();
  const group = await groupOf(loop.groupId);
  await createEvent({ kind: "once", title: "Party", emoji: "", date: "2026-03-01", membershipId: null, group, at: BEFORE_ANY_ISSUE });
  const [event] = await db.select().from(events);
  const input = { title: "Bigger party", emoji: "🎈", date: "2026-03-02", membershipId: null, group, at: BEFORE_ANY_ISSUE };

  assert.deepEqual(await updateEvent({ ...input, eventId: event.id }), { ok: true });
  const [saved] = await db.select().from(events);
  assert.equal(saved.title, "Bigger party");
  assert.equal(saved.day, 2);
  assert.equal(saved.kind, "once");

  assert.deepEqual(await updateEvent({ ...input, eventId: "00000000-0000-4000-8000-000000000000" }), { ok: false, code: "invalid" });
  assert.deepEqual(await updateEvent({ ...input, eventId: event.id, date: "nope" }), { ok: false, code: "invalid" });
  // A date that has already passed is fine to keep editing.
  assert.deepEqual(await updateEvent({ ...input, eventId: event.id, date: "2020-01-01" }), { ok: true });
});

test("deleting an event only works inside its own loop", async () => {
  const loop = await seedLoop();
  const other = await seedLoop({ name: "Other", owner: { email: "other@friendloop.test", name: "Olive" }, members: [] });
  await createEvent({ kind: "once", title: "Party", emoji: "", date: "2026-03-01", membershipId: null, group: await groupOf(loop.groupId), at: BEFORE_ANY_ISSUE });
  const [event] = await db.select().from(events);

  await deleteEvent({ groupId: other.groupId, eventId: event.id });
  assert.equal((await db.select().from(events)).length, 1);
  await deleteEvent({ groupId: loop.groupId, eventId: event.id });
  assert.equal((await db.select().from(events)).length, 0);
});

test("a birthday row with no person yet to celebrate places nothing", async () => {
  const loop = await seedLoop();
  await db.insert(events).values({ groupId: loop.groupId, kind: "birthday", month: 1, day: 6, membershipId: null });
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
  const placed = await snapshotEventsForIssue({ group, issueId: next.id, opensAt, deliversAt, nextSlotAt: deliversAt });
  assert.equal(placed, 1);
  const found = await eventSections();
  assert.deepEqual(found.map((row) => row.event_date), ["2026-01-06", "2027-01-06"]);
});

test("several events in one window follow the calendar, after the regular sections", async () => {
  const loop = await seedLoop();
  await db.insert(sections).values({
    groupId: loop.groupId, kind: "standard", title: "The potluck corner", emoji: null,
    description: null, adminOnly: false, position: 0, createdAt: new Date(),
  });
  // Added latest-date first on purpose.
  await addBirthday(loop, "1990-01-08", "bob");
  await addBirthday(loop, "1990-01-04", "alice");
  await sweep({ at: AFTER_FIRST_SLOT });

  const order = await rows<{ title: string }>("select title from issue_sections order by position asc");
  assert.deepEqual(order.map((row) => row.title), ["The potluck corner", "Alice's birthday", "Bob's birthday"]);
});

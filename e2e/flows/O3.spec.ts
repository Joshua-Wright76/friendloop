import { test, expect } from "../support/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop, seedReplies } from "../support/seed";
import { AFTER_FIRST_SLOT, DAY, runSweep } from "../support/harness";
import { copy, text as copyText } from "@/lib/copy";

test.beforeEach(async () => {
  await resetDatabase();
});

type Placed = { number: number; title: string; event_date: string };
const placements = () =>
  rows<Placed>(
    `select i.number, s.text as title, s.occurrence_date::text as event_date
       from issue_questions s join issues i on i.id = s.issue_id
      where s.occurrence_date is not null order by i.number, s.position`,
  );

test("O3 · a birthday lands in exactly one round, however many weekly rounds open around it", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  // 20 January 2026 is a Tuesday: it belongs to the round open from Friday the 16th to the 23rd.
  await rows("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 1, 20, $2)", [loop.groupId, alice.id]);

  for (let week = 0; week < 7; week += 1) {
    const at = new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * DAY);
    // Someone answers each round, so each one goes out and opens the next.
    const [open] = await rows<{ id: string }>("select id from issues where group_id = $1 and status = 'open'", [loop.groupId]);
    if (open) await seedReplies({ issueId: open.id, membershipId: alice.id, answers: [{ text: "What made you laugh this week?", body: "Week " + week }] });
    await runSweep(at);
    // A second trigger at the same moment changes nothing.
    await runSweep(at);
  }

  const issues = await rows<{ count: number }>("select count(*)::int as count from issues");
  expect(issues[0].count).toBeGreaterThanOrEqual(6);
  expect(await placements()).toEqual([{ number: 3, title: copyText(copy.events.birthdayRow, { name: "Alice" }), event_date: "2026-01-20" }]);
});

test("O3 · a biweekly round covers both of its weeks", async () => {
  const loop = await seedLoop({ cadenceWeeks: 2 });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  // Round 1 is open from the 2nd until it goes out on the 16th, so the 13th is in it.
  await rows("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 1, 13, $2)", [loop.groupId, bob.id]);

  for (let round = 0; round < 3; round += 1) {
    await rows("update groups set paused_at = null where id = $1", [loop.groupId]);
    await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + round * 14 * DAY));
  }
  expect(await placements()).toEqual([{ number: 1, title: copyText(copy.events.birthdayRow, { name: "Bob" }), event_date: "2026-01-13" }]);
});

test("O3 · a birthday on the last day of the year reaches a round that crosses New Year", async () => {
  // Rounds open on Fridays: 26 December 2025 covers 26 Dec through 2 Jan.
  const loop = await seedLoop({ createdAt: new Date("2025-12-01T00:00:00Z") });
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  await rows("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 12, 31, $2), ($1, 'birthday', 1, 1, $3)", [
    loop.groupId,
    alice.id,
    loop.members.find((member) => member.email.startsWith("bob"))!.id,
  ]);
  await runSweep(new Date("2025-12-26T08:05:00Z"));

  expect(await placements()).toEqual([
    { number: 1, title: copyText(copy.events.section.birthdayTitle, { name: "Alice" }), event_date: "2025-12-31" },
    { number: 1, title: copyText(copy.events.section.birthdayTitle, { name: "Bob" }), event_date: "2026-01-01" },
  ]);
});

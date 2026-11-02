import { test, expect } from "@playwright/test";
import { resetDatabase, rows } from "../support/db";
import { seedLoop } from "../support/seed";
import { AFTER_FIRST_SLOT, DAY, runSweep } from "../support/harness";

test.beforeEach(async () => {
  await resetDatabase();
});

type Placed = { number: number; title: string; event_date: string };
const placements = () =>
  rows<Placed>(
    `select i.number, s.title, s.event_date::text as event_date
       from issue_sections s join issues i on i.id = s.issue_id
      where s.event_id is not null order by i.number, s.position`,
  );

test("O3 · a birthday lands in exactly one round, however many weekly rounds open around it", async () => {
  const loop = await seedLoop();
  const alice = loop.members.find((member) => member.email.startsWith("alice"))!;
  // 20 January 2026 is a Tuesday: it belongs to the round that opens on Friday the 16th.
  await rows("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 1, 20, $2)", [loop.groupId, alice.id]);

  for (let week = 0; week < 7; week += 1) {
    // Nobody answers, so every round is skipped and pauses the loop; keep it running.
    await rows("update groups set paused_at = null where id = $1", [loop.groupId]);
    const at = new Date(AFTER_FIRST_SLOT.getTime() + week * 7 * DAY);
    await runSweep(at);
    // A second trigger at the same moment changes nothing.
    await runSweep(at);
  }

  const issues = await rows<{ count: number }>("select count(*)::int as count from issues");
  expect(issues[0].count).toBeGreaterThanOrEqual(6);
  expect(await placements()).toEqual([{ number: 3, title: "Alice's birthday", event_date: "2026-01-20" }]);
});

test("O3 · a window shorter than the cadence still catches a date between two rounds", async () => {
  const loop = await seedLoop({ cadenceWeeks: 2 });
  const bob = loop.members.find((member) => member.email.startsWith("bob"))!;
  // Round 1 delivers on the 9th and round 2 opens on the 16th: the 13th is in the gap.
  await rows("insert into events (group_id, kind, month, day, membership_id) values ($1, 'birthday', 1, 13, $2)", [loop.groupId, bob.id]);

  for (let round = 0; round < 3; round += 1) {
    await rows("update groups set paused_at = null where id = $1", [loop.groupId]);
    await runSweep(new Date(AFTER_FIRST_SLOT.getTime() + round * 14 * DAY));
  }
  expect(await placements()).toEqual([{ number: 1, title: "Bob's birthday", event_date: "2026-01-13" }]);
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
    { number: 1, title: "Alice's birthday", event_date: "2025-12-31" },
    { number: 1, title: "Bob's birthday", event_date: "2026-01-01" },
  ]);
});

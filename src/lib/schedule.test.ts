import { test } from "node:test";
import assert from "node:assert/strict";
import { carriedOver, describeDeadline, nextSlot, weekdayName, type LoopSchedule } from "./schedule.ts";
import { copy } from "./copy.ts";

const base: LoopSchedule = {
  timezone: "Europe/Amsterdam",
  promptWeekday: 5, // Friday
  promptHour: 9,
  cadenceWeeks: 1,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const utc = (iso: string) => new Date(iso);

test("delivery is at local 09:00 in winter (UTC+1)", () => {
  assert.equal(nextSlot(base, utc("2026-01-02T06:59:00Z")).toISOString(), "2026-01-02T08:00:00.000Z");
});

test("the same wall clock is a different instant in summer (UTC+2)", () => {
  assert.equal(nextSlot(base, utc("2026-07-03T06:00:00Z")).toISOString(), "2026-07-03T07:00:00.000Z");
});

test("next delivery is always strictly in the future", () => {
  assert.equal(nextSlot(base, utc("2026-01-05T00:00:00Z")).toISOString(), "2026-01-09T08:00:00.000Z");
  assert.equal(nextSlot(base, utc("2026-01-09T08:00:00Z")).toISOString(), "2026-01-16T08:00:00.000Z");
});

test("a long outage still names the next delivery, not a missed one", () => {
  assert.equal(nextSlot(base, utc("2026-02-20T09:00:00Z")).toISOString(), "2026-02-27T08:00:00.000Z");
});

test("biweekly cadence steps 14 days, anchored on real occurrences", () => {
  const schedule = { ...base, cadenceWeeks: 2 };
  assert.equal(nextSlot(schedule, utc("2026-01-02T08:00:00Z")).toISOString(), "2026-01-16T08:00:00.000Z");
  assert.equal(nextSlot(schedule, utc("2026-01-09T09:00:00Z")).toISOString(), "2026-01-16T08:00:00.000Z"); // off week
  assert.equal(nextSlot(schedule, utc("2026-01-16T08:00:00Z")).toISOString(), "2026-01-30T08:00:00.000Z");
});

test("the next delivery keeps the local wall clock across a DST change", () => {
  // Fri 09:00 CET, DST starts Mar 29; the delivery after is Fri 09:00 CEST.
  assert.equal(nextSlot(base, utc("2026-03-27T08:00:00Z")).toISOString(), "2026-04-03T07:00:00.000Z");
});

test("a fresh round has not been carried over; each later delivery counts once", () => {
  const friday = utc("2026-01-09T08:00:00Z");
  assert.equal(carriedOver(base, { slotAt: friday, deliversAt: friday }), 0);
  assert.equal(carriedOver(base, { slotAt: friday, deliversAt: utc("2026-01-16T08:00:00Z") }), 1);
  assert.equal(carriedOver(base, { slotAt: friday, deliversAt: utc("2026-01-23T08:00:00Z") }), 2);
  assert.equal(carriedOver({ ...base, cadenceWeeks: 2 }, { slotAt: friday, deliversAt: utc("2026-01-23T08:00:00Z") }), 1);
});

test("deadlines render in both clocks, and collapse when identical", () => {
  const instant = utc("2026-01-09T08:00:00Z");
  const same = describeDeadline(instant, "Europe/Amsterdam", "Europe/Amsterdam");
  assert.equal(same.inViewerZone, null);
  assert.match(same.inLoopZone, /Friday/);

  const far = describeDeadline(instant, "Europe/Amsterdam", "Pacific/Auckland");
  assert.match(far.inViewerZone ?? "", /Friday/);
  assert.match(far.inViewerZone ?? "", /9:00/); // 08:00Z is 21:00 in Auckland; weekday flips for some zones
});

test("a viewer far east sees the deadline on their own clock", () => {
  const instant = utc("2026-01-09T08:00:00Z"); // Fri 09:00 Amsterdam
  const auckland = describeDeadline(instant, "Europe/Amsterdam", "Pacific/Auckland");
  assert.match(auckland.inViewerZone ?? "", /9:00 PM/);
});

test("a loop created on its delivery day, before the hour, goes out that same day", () => {
  // Thursday 9:00 delivery, created Thursday 00:00: round 1 goes out this morning.
  const schedule: LoopSchedule = {
    ...base,
    timezone: "UTC",
    promptWeekday: 4,
    promptHour: 9,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  assert.equal(nextSlot(schedule, new Date("2026-01-01T00:00:00Z")).toISOString(), "2026-01-01T09:00:00.000Z");
});

test("a loop created after its delivery hour goes out a full cycle later", () => {
  // Created Friday 10:00 in a Friday 9:00 loop: round 1 goes out next Friday.
  const schedule: LoopSchedule = {
    ...base,
    timezone: "UTC",
    createdAt: new Date("2026-01-02T10:00:00Z"),
  };
  assert.equal(nextSlot(schedule, new Date("2026-01-02T10:00:00Z")).toISOString(), "2026-01-09T09:00:00.000Z");
});

test("next delivery is still correct on the day itself before the hour", () => {
  // Friday 08:00 local, delivery is 09:00 the same day.
  assert.equal(nextSlot(base, new Date("2026-01-02T07:00:00Z")).toISOString(), "2026-01-02T08:00:00.000Z");
});

test("weekday names cover the week and fall back for nonsense", () => {
  assert.equal(weekdayName(0), copy.common.weekdays[0]);
  assert.equal(weekdayName(5), copy.common.weekdays[5]);
  assert.equal(weekdayName(9), copy.common.weekdays[5]);
});

test("a loop created exactly on its slot goes out a cycle later, not this instant", () => {
  const schedule: LoopSchedule = {
    ...base,
    timezone: "UTC",
    createdAt: new Date("2026-01-02T09:00:00Z"), // Friday 09:00, the slot itself
  };
  assert.equal(nextSlot(schedule, new Date("2026-01-02T09:00:00Z")).toISOString(), "2026-01-09T09:00:00.000Z");
});

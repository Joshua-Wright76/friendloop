import { test } from "node:test";
import assert from "node:assert/strict";
import { deliveryInstant, describeDeadline, dueSlot, nextSlot, type LoopSchedule } from "./schedule.ts";

const base: LoopSchedule = {
  timezone: "Europe/Amsterdam",
  promptWeekday: 5, // Friday
  promptHour: 9,
  cadenceWeeks: 1,
  windowDays: 7,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  lastSlotAt: null,
};

const utc = (iso: string) => new Date(iso);

test("nothing is due before the first slot", () => {
  assert.equal(dueSlot(base, utc("2026-01-02T06:59:00Z")), null); // Fri 07:59 CET
});

test("the slot fires at local 09:00 in winter (UTC+1)", () => {
  const slot = dueSlot(base, utc("2026-01-02T08:00:01Z"));
  assert.equal(slot?.toISOString(), "2026-01-02T08:00:00.000Z");
});

test("the same wall clock is a different instant in summer (UTC+2)", () => {
  const slot = dueSlot(base, utc("2026-07-03T07:00:01Z"));
  assert.equal(slot?.toISOString(), "2026-07-03T07:00:00.000Z");
});

test("a slot already materialized is not due again", () => {
  const schedule = { ...base, lastSlotAt: utc("2026-01-02T08:00:00Z") };
  assert.equal(dueSlot(schedule, utc("2026-01-02T09:00:00Z")), null);
  assert.equal(dueSlot(schedule, utc("2026-01-05T09:00:00Z")), null);
  assert.equal(dueSlot(schedule, utc("2026-01-09T08:00:01Z"))?.toISOString(), "2026-01-09T08:00:00.000Z");
});

test("a long outage collapses to the single most recent slot", () => {
  const slot = dueSlot(base, utc("2026-02-20T09:00:00Z")); // ~7 weeks later
  assert.equal(slot?.toISOString(), "2026-02-20T08:00:00.000Z");
});

test("biweekly cadence steps 14 days, anchored on real occurrences", () => {
  let schedule = { ...base, cadenceWeeks: 2, lastSlotAt: utc("2026-01-02T08:00:00Z") };
  assert.equal(dueSlot(schedule, utc("2026-01-09T09:00:00Z")), null); // off week
  const third = dueSlot(schedule, utc("2026-01-16T09:00:00Z"));
  assert.equal(third?.toISOString(), "2026-01-16T08:00:00.000Z");
  schedule = { ...schedule, lastSlotAt: third! };
  assert.equal(dueSlot(schedule, utc("2026-01-23T09:00:00Z")), null); // off week again
});

test("next slot is always strictly in the future", () => {
  assert.equal(nextSlot(base, utc("2026-01-05T00:00:00Z")).toISOString(), "2026-01-09T08:00:00.000Z");
  assert.equal(nextSlot(base, utc("2026-01-09T08:00:00Z")).toISOString(), "2026-01-16T08:00:00.000Z");
});

test("delivery keeps the local wall clock across a DST change", () => {
  const opensAt = utc("2026-03-27T08:00:00Z"); // Fri 09:00 CET, DST starts Mar 29
  const delivers = deliveryInstant(opensAt, base);
  assert.equal(delivers.toISOString(), "2026-04-03T07:00:00.000Z"); // Fri 09:00 CEST
  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  }).format(delivers);
  assert.match(label, /Friday/);
  assert.match(label, /9:00/);
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

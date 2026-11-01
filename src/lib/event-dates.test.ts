import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeDate,
  isRealMonthDay,
  issueCoverage,
  localDate,
  nextOccurrence,
  occurrenceIn,
  occurrencesInWindow,
  parseDateInput,
  type EventRule,
} from "./event-dates.ts";

const birthday = (month: number, day: number): EventRule => ({ kind: "birthday", month, day, year: null });
const once = (year: number, month: number, day: number): EventRule => ({ kind: "once", month, day, year });

test("an instant becomes the local date of the loop, not of UTC", () => {
  // 23:30 UTC on 4 Jan is already 5 Jan in Amsterdam and still 4 Jan in New York.
  const instant = new Date("2026-01-04T23:30:00Z");
  assert.equal(localDate(instant, "Europe/Amsterdam"), "2026-01-05");
  assert.equal(localDate(instant, "America/New_York"), "2026-01-04");
});

test("coverage runs from the opening day through delivery when the window fills the cadence", () => {
  const coverage = issueCoverage({
    opensAt: new Date("2026-01-02T08:00:00Z"),
    deliversAt: new Date("2026-01-09T08:00:00Z"),
    nextSlotAt: new Date("2026-01-09T08:00:00Z"),
    timezone: "Europe/Amsterdam",
  });
  // Delivery day is the last covered date; the next slot's own day belongs to this issue too.
  assert.deepEqual(coverage, { start: "2026-01-02", end: "2026-01-09" });
});

test("a window shorter than the cadence stretches to the day before the next slot", () => {
  const coverage = issueCoverage({
    opensAt: new Date("2026-01-02T08:00:00Z"),
    deliversAt: new Date("2026-01-09T08:00:00Z"),
    nextSlotAt: new Date("2026-01-16T08:00:00Z"),
    timezone: "Europe/Amsterdam",
  });
  assert.deepEqual(coverage, { start: "2026-01-02", end: "2026-01-15" });
});

test("a window longer than the cadence keeps its own delivery day", () => {
  const coverage = issueCoverage({
    opensAt: new Date("2026-01-02T08:00:00Z"),
    deliversAt: new Date("2026-01-23T08:00:00Z"),
    nextSlotAt: new Date("2026-01-09T08:00:00Z"),
    timezone: "Europe/Amsterdam",
  });
  assert.deepEqual(coverage, { start: "2026-01-02", end: "2026-01-23" });
});

test("a window that crosses a DST change still ends on the local delivery date", () => {
  // Amsterdam springs forward on 29 Mar 2026: 09:00 local is 08:00Z before, 07:00Z after.
  const coverage = issueCoverage({
    opensAt: new Date("2026-03-27T08:00:00Z"),
    deliversAt: new Date("2026-04-03T07:00:00Z"),
    nextSlotAt: new Date("2026-04-03T07:00:00Z"),
    timezone: "Europe/Amsterdam",
  });
  assert.deepEqual(coverage, { start: "2026-03-27", end: "2026-04-03" });
});

test("a window straddling New Year finds a birthday on either side", () => {
  const window = { start: "2025-12-26", end: "2026-01-02" };
  assert.deepEqual(occurrencesInWindow(birthday(12, 30), window), ["2025-12-30"]);
  assert.deepEqual(occurrencesInWindow(birthday(1, 1), window), ["2026-01-01"]);
  assert.deepEqual(occurrencesInWindow(birthday(1, 3), window), []);
});

test("a birthday yields exactly one date per year", () => {
  const dates = occurrencesInWindow(birthday(6, 15), { start: "2026-01-01", end: "2028-12-31" });
  assert.deepEqual(dates, ["2026-06-15", "2027-06-15", "2028-06-15"]);
});

test("a one-time event only ever matches its own year", () => {
  assert.deepEqual(occurrencesInWindow(once(2026, 3, 9), { start: "2026-03-01", end: "2026-03-31" }), ["2026-03-09"]);
  assert.deepEqual(occurrencesInWindow(once(2026, 3, 9), { start: "2027-03-01", end: "2027-03-31" }), []);
  assert.equal(occurrenceIn(once(2026, 3, 9), 2027), null);
});

test("a 29 February birthday keeps to 28 February in years without one", () => {
  assert.equal(occurrenceIn(birthday(2, 29), 2028), "2028-02-29");
  assert.equal(occurrenceIn(birthday(2, 29), 2027), "2027-02-28");
  assert.equal(occurrenceIn(birthday(2, 29), 2100), "2100-02-28");
  assert.deepEqual(occurrencesInWindow(birthday(2, 29), { start: "2027-02-20", end: "2027-03-05" }), ["2027-02-28"]);
});

test("the next occurrence is today, later this year, next year, or never", () => {
  assert.equal(nextOccurrence(birthday(6, 15), "2026-06-15"), "2026-06-15");
  assert.equal(nextOccurrence(birthday(6, 15), "2026-06-16"), "2027-06-15");
  assert.equal(nextOccurrence(birthday(2, 29), "2026-03-01"), "2027-02-28");
  assert.equal(nextOccurrence(once(2026, 3, 9), "2026-03-09"), "2026-03-09");
  assert.equal(nextOccurrence(once(2026, 3, 9), "2026-03-10"), null);
});

test("month and day must exist; a birthday may be 29 February", () => {
  assert.equal(isRealMonthDay(2, 29, null), true);
  assert.equal(isRealMonthDay(2, 29, 2027), false);
  assert.equal(isRealMonthDay(2, 29, 2028), true);
  assert.equal(isRealMonthDay(4, 31, 2026), false);
  assert.equal(isRealMonthDay(13, 1, 2026), false);
  assert.equal(isRealMonthDay(1, 0, 2026), false);
  assert.equal(isRealMonthDay(1.5, 1, 2026), false);
  assert.equal(isRealMonthDay(1, 1, 1800), false);
});

test("a date input parses only when it is a real date", () => {
  assert.deepEqual(parseDateInput("2026-03-09"), { year: 2026, month: 3, day: 9 });
  assert.equal(parseDateInput("2026-02-30"), null);
  assert.equal(parseDateInput("March 9"), null);
  assert.equal(parseDateInput(""), null);
});

test("a date reads the same wherever the server runs", () => {
  assert.equal(describeDate("2026-03-09"), "Mon, Mar 9");
  assert.equal(describeDate("2026-12-31"), "Thu, Dec 31");
});

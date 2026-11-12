import { test } from "node:test";
import assert from "node:assert/strict";
import { atMoment, formatDate, formatHour, formatMoment, formatTimeInZone, listNames, momentsOf, timezonePlace } from "./format.ts";
import { copy, text } from "./copy.ts";

const DELIVERY = new Date("2026-10-30T08:00:00Z");

test("a round's date is the loop's own wall clock", () => {
  assert.equal(formatDate(DELIVERY, "Europe/Amsterdam"), "Fri 30 Oct");
  // Same instant, one day earlier on the other side of the date line.
  assert.equal(formatDate(DELIVERY, "America/Los_Angeles"), "Fri 30 Oct");
  assert.equal(formatDate(DELIVERY, "Pacific/Auckland"), "Fri 30 Oct");
});

test("an instant near midnight belongs to the right local day", () => {
  const late = new Date("2026-10-30T23:30:00Z");
  assert.equal(formatDate(late, "Europe/Amsterdam"), "Sat 31 Oct");
  assert.equal(formatDate(late, "America/New_York"), "Fri 30 Oct");
});

test("an unknown zone falls back to UTC instead of throwing", () => {
  assert.equal(formatDate(DELIVERY, "Not/AZone"), "Fri 30 Oct");
});

test("someone else's clock keeps the same instant", () => {
  assert.equal(formatTimeInZone(DELIVERY, "Asia/Tokyo"), "Friday 17:00");
  assert.equal(formatTimeInZone(DELIVERY, "America/New_York"), "Friday 04:00");
});

test("an unknown zone falls back to UTC for the time too, instead of throwing", () => {
  assert.equal(formatTimeInZone(DELIVERY, "Not/AZone"), "Friday 08:00");
});

test("a moment reads the same everywhere, and midnight names the day it ends", () => {
  assert.equal(formatMoment(new Date("2026-11-06T08:00:00Z"), "Europe/Amsterdam"), "Fri 6 Nov, 9:00 AM");
  assert.equal(formatMoment(new Date("2026-11-06T08:00:00Z"), "America/Los_Angeles"), "end of Thu 5 Nov");
  assert.equal(atMoment("end of Thu 5 Nov"), "at the end of Thu 5 Nov");
  assert.equal(atMoment("Fri 6 Nov, 9:00 AM"), "on Fri 6 Nov, 9:00 AM");
});

test("a place, an hour and a list of names read the way a person says them", () => {
  assert.equal(timezonePlace("America/Los_Angeles"), "Los Angeles");
  assert.equal(formatHour(0), "12:00 AM");
  assert.equal(formatHour(21), "9:00 PM");
  assert.equal(listNames(["Sam"]), "Sam");
  assert.equal(listNames(["Sam", "Alice"]), "Sam and Alice");
  assert.equal(listNames(["Sam", "Alice", "Bo"]), "Sam, Alice and Bo");
});

test("an unknown zone falls back to UTC for a moment too, instead of throwing", () => {
  assert.equal(formatMoment(new Date("2026-11-06T08:00:00Z"), "Not/AZone"), "Fri 6 Nov, 8:00 AM");
});

test("a deadline reads on the reader's clock first, the loop's in brackets, and names midnight", () => {
  const goesOut = new Date("2026-11-06T08:00:00Z");
  // A reader in Los Angeles: their own night before midnight, then the loop's morning.
  const endOfThu = text(copy.loop.momentMidnight, { moment: "end of Thu 5 Nov" });
  assert.deepEqual(momentsOf(goesOut, "Europe/Amsterdam", "America/Los_Angeles"), {
    primary: text(copy.loop.momentYours, { moment: endOfThu }),
    loop: text(copy.loop.momentElsewhere, { moment: "Fri 6 Nov, 9:00 AM", place: "Amsterdam" }),
  });
  // Same zone as the loop: one time, nothing in brackets.
  assert.deepEqual(momentsOf(goesOut, "Europe/Amsterdam", "Europe/Amsterdam"), { primary: "Fri 6 Nov, 9:00 AM", loop: null });
  // Unknown reader zone: the loop's time, with its place named.
  assert.deepEqual(momentsOf(goesOut, "Europe/Amsterdam", null), {
    primary: text(copy.loop.momentNamed, { moment: "Fri 6 Nov, 9:00 AM", place: "Amsterdam" }),
    loop: null,
  });
});

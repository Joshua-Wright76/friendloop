import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDate, formatTimeInZone } from "./format.ts";

const DELIVERY = new Date("2026-10-30T08:00:00Z");

test("a round's date is the loop's own wall clock", () => {
  assert.equal(formatDate(DELIVERY, "Europe/Amsterdam"), "Friday 30 October");
  // Same instant, one day earlier on the other side of the date line.
  assert.equal(formatDate(DELIVERY, "America/Los_Angeles"), "Friday 30 October");
  assert.equal(formatDate(DELIVERY, "Pacific/Auckland"), "Friday 30 October");
});

test("an instant near midnight belongs to the right local day", () => {
  const late = new Date("2026-10-30T23:30:00Z");
  assert.equal(formatDate(late, "Europe/Amsterdam"), "Saturday 31 October");
  assert.equal(formatDate(late, "America/New_York"), "Friday 30 October");
});

test("an unknown zone falls back to UTC instead of throwing", () => {
  assert.equal(formatDate(DELIVERY, "Not/AZone"), "Friday 30 October");
});

test("someone else's clock keeps the same instant", () => {
  assert.equal(formatTimeInZone(DELIVERY, "Asia/Tokyo"), "Friday 17:00");
  assert.equal(formatTimeInZone(DELIVERY, "America/New_York"), "Friday 04:00");
});

test("an unknown zone falls back to UTC for the time too, instead of throwing", () => {
  assert.equal(formatTimeInZone(DELIVERY, "Not/AZone"), "Friday 08:00");
});

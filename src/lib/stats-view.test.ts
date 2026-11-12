import assert from "node:assert/strict";
import { test } from "node:test";
import { changePercent, parseStatsRange, statsWindow } from "./stats-view.ts";

test("the reporting range accepts only the three offered windows", () => {
  assert.equal(parseStatsRange("7"), 7);
  assert.equal(parseStatsRange("30"), 30);
  assert.equal(parseStatsRange("90"), 90);
  assert.equal(parseStatsRange("14"), 30);
  assert.equal(parseStatsRange("nope"), 30);
  assert.equal(parseStatsRange(undefined), 30);
  assert.equal(parseStatsRange(["7", "90"]), 7);
  assert.equal(parseStatsRange([]), 30);
});

test("the current and previous windows use adjacent whole UTC days", () => {
  const window = statsWindow(7, new Date("2026-03-08T23:30:00Z"));
  assert.equal(window.start.toISOString(), "2026-03-02T00:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-03-09T00:00:00.000Z");
  assert.equal(window.previousStart.toISOString(), "2026-02-23T00:00:00.000Z");
});

test("trend percentages handle growth, decline, and an empty baseline", () => {
  assert.equal(changePercent(15, 10), 50);
  assert.equal(changePercent(5, 10), -50);
  assert.equal(changePercent(10, 10), 0);
  assert.equal(changePercent(1, 0), null);
  assert.equal(changePercent(0, 0), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { isReminderPreference, REMINDER_LEADS_MS, wantsReminder } from "./reminders.ts";

test("everyone who asked for all of them has every reminder", () => {
  assert.deepEqual([0, 1, 2].map((index) => wantsReminder("all", index, 3)), [true, true, true]);
});

test("last-only people get only the final reminder", () => {
  assert.deepEqual([0, 1, 2].map((index) => wantsReminder("last", index, 3)), [false, false, true]);
});

test("nobody on none gets anything", () => {
  assert.deepEqual([0, 1, 2].map((index) => wantsReminder("none", index, 3)), [false, false, false]);
});

test("the loop's single reminder is the last one", () => {
  assert.equal(REMINDER_LEADS_MS.length, 1);
  assert.equal(wantsReminder("last", 0, REMINDER_LEADS_MS.length), true);
  assert.equal(wantsReminder("all", 0, REMINDER_LEADS_MS.length), true);
  assert.equal(wantsReminder("none", 0, REMINDER_LEADS_MS.length), false);
});

test("exactly the three stored values are preferences", () => {
  assert.equal(["all", "last", "none"].every(isReminderPreference), true);
  assert.equal(isReminderPreference("some"), false);
  assert.equal(isReminderPreference(undefined), false);
  assert.equal(isReminderPreference(3), false);
});

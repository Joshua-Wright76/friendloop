import { test } from "node:test";
import assert from "node:assert/strict";
import { REMINDER_LEAD_MS, remindersOn, storedReminderPreference } from "./reminders.ts";

test("reminders are on unless someone switched them off", () => {
  assert.equal(remindersOn("all"), true);
  assert.equal(remindersOn("none"), false);
});

test("the old 'only the last reminder' reads as on", () => {
  assert.equal(remindersOn("last"), true);
});

test("the loop's one reminder goes 48 hours before delivery", () => {
  assert.equal(REMINDER_LEAD_MS, 48 * 60 * 60 * 1000);
});

test("only on and off are stored, and an old page's 'last' is stored as on", () => {
  assert.equal(storedReminderPreference("all"), "all");
  assert.equal(storedReminderPreference("none"), "none");
  assert.equal(storedReminderPreference("last"), "all");
  assert.equal(storedReminderPreference("some"), null);
  assert.equal(storedReminderPreference(undefined), null);
  assert.equal(storedReminderPreference(true), null);
});

export type ReminderPreference = "all" | "last" | "none";

export const REMINDER_PREFERENCES: readonly ReminderPreference[] = ["all", "last", "none"];

const HOUR_MS = 60 * 60 * 1000;

/**
 * When the loop's automatic reminders go out, as lead times before delivery,
 * earliest first. The loop sends one: 48 hours ahead. A second entry later (say
 * 24 hours) makes "all" and "last" differ without touching a stored preference.
 */
export const REMINDER_LEADS_MS: readonly number[] = [48 * HOUR_MS];

export function isReminderPreference(value: unknown): value is ReminderPreference {
  return typeof value === "string" && (REMINDER_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Whether a contributor with this preference should get the reminder at `index`
 * of a schedule of `total`. A manual nudge never asks: it is the owner's choice.
 */
export function wantsReminder(preference: ReminderPreference, index: number, total: number): boolean {
  if (preference === "none") return false;
  if (preference === "last") return index === total - 1;
  return true;
}

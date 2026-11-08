/**
 * What the database stores. Reminders are one switch, on or off; "last" is left
 * from when there were three choices that all behaved the same, and reads as on.
 */
export type ReminderPreference = "all" | "last" | "none";

const HOUR_MS = 60 * 60 * 1000;

/** The loop sends one automatic reminder, this long before delivery. */
export const REMINDER_LEAD_MS = 48 * HOUR_MS;

/** Whether the loop's automatic reminder goes to someone with this stored preference. */
export function remindersOn(preference: ReminderPreference): boolean {
  return preference !== "none";
}

/**
 * The value to store for a request to turn reminders on ("all") or off ("none"),
 * or null for anything else. A page opened before the switch replaced the three
 * choices may still send "last", which means on.
 */
export function storedReminderPreference(value: unknown): "all" | "none" | null {
  if (value === "none") return "none";
  if (value === "all" || value === "last") return "all";
  return null;
}

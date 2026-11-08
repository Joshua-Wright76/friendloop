import { Temporal } from "temporal-polyfill";

/**
 * Calendar math for events and birthdays. Pure: callers pass instants and zones.
 *
 * Everything is a plain local date (`YYYY-MM-DD`, compared as a string), because a
 * birthday is a date on a calendar, not an instant. Instants only enter at the edge,
 * where a window's opening, delivery and next slot are read as dates in the loop's
 * own timezone. That is what keeps a window that crosses a DST change, or midnight
 * in another zone, from moving an event by a day.
 */
export const EVENT_TITLE_MAX = 80;

export type EventRule = {
  kind: "once" | "birthday";
  month: number;
  day: number;
  /** Required for a one-time event, ignored for a birthday. */
  year: number | null;
};

export type EventWindow = {
  /** First local date covered, inclusive. */
  start: string;
  /** Last local date covered, inclusive. */
  end: string;
};

/** The local calendar date of an instant in a zone. */
export function localDate(instant: Date, timezone: string): string {
  return Temporal.Instant.from(instant.toISOString())
    .toZonedDateTimeISO(timezone)
    .toPlainDate()
    .toString();
}

/**
 * The dates a round answers for: from the day it opens through the day it goes
 * out. Rounds run back to back, so together they cover every day, and an event
 * lands in the round that is open as its date approaches.
 */
export function issueCoverage(input: { opensAt: Date; deliversAt: Date; timezone: string }): EventWindow {
  return { start: localDate(input.opensAt, input.timezone), end: localDate(input.deliversAt, input.timezone) };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/**
 * One year's date for a rule. A 29 February birthday keeps to 28 February in years
 * without one: celebrating a day early beats celebrating a day after the birthday
 * has already passed.
 */
export function occurrenceIn(rule: EventRule, year: number): string | null {
  if (rule.kind === "once") {
    return rule.year === year ? `${pad(year, 4)}-${pad(rule.month, 2)}-${pad(rule.day, 2)}` : null;
  }
  const day = rule.month === 2 && rule.day === 29 && !Temporal.PlainDate.from({ year, month: 1, day: 1 }).inLeapYear
    ? 28
    : rule.day;
  return `${pad(year, 4)}-${pad(rule.month, 2)}-${pad(day, 2)}`;
}

/** Every date of a rule inside a window, in order. */
export function occurrencesInWindow(rule: EventRule, window: EventWindow): string[] {
  const first = Number(window.start.slice(0, 4));
  const last = Number(window.end.slice(0, 4));
  const found: string[] = [];
  for (let year = first; year <= last; year += 1) {
    const date = occurrenceIn(rule, year);
    if (date && date >= window.start && date <= window.end) found.push(date);
  }
  return found;
}

/** The next date on or after `today`, or null for a one-time event that has passed. */
export function nextOccurrence(rule: EventRule, today: string): string | null {
  const year = Number(today.slice(0, 4));
  for (let candidate = year; candidate <= year + 1; candidate += 1) {
    const date = occurrenceIn(rule, candidate);
    if (date && date >= today) return date;
  }
  return null;
}

/** Whether month and day are a real date; February 29 is allowed for birthdays. */
export function isRealMonthDay(month: number, day: number, year: number | null): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1) return false;
  // A birthday has no year, so judge it against a leap year.
  const probe = year ?? 2000;
  if (!Number.isInteger(probe) || probe < 1900 || probe > 2200) return false;
  return day <= Temporal.PlainDate.from({ year: probe, month, day: 1 }).daysInMonth;
}

/** Parse the `YYYY-MM-DD` a date input submits. */
export function parseDateInput(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isRealMonthDay(month, day, year) ? { year, month, day } : null;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** "Mon, Mar 9" for an ISO date, with no timezone drift because it is only a date. */
export function describeDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return dateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
}

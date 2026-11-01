import { Temporal } from "temporal-polyfill";
import { copy } from "./copy.ts";

/**
 * Schedule math. Everything here is pure: callers pass `at` explicitly.
 *
 * A loop's schedule is stored as local wall-clock fields (weekday, hour, zone),
 * never as a precomputed future instant, because a DST transition would silently
 * shift a stored instant by an hour. Instants are resolved on demand and frozen
 * only on the issue that actually opened.
 */
export type LoopSchedule = {
  timezone: string;
  /** 0 = Sunday … 6 = Saturday, evaluated in `timezone`. */
  promptWeekday: number;
  /** Local hour, 0–23. */
  promptHour: number;
  cadenceWeeks: number;
  /** Reply window in days; delivery is the same wall clock this far later. */
  windowDays: number;
  createdAt: Date;
  /** Nothing before this is ever materialized (pause/resume sets it to "now"). */
  lastSlotAt: Date | null;
};

/** A group row's schedule fields, in the shape the math above takes. */
export function groupSchedule(group: {
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  windowDays: number;
  createdAt: Date;
  lastSlotAt: Date | null;
}): LoopSchedule {
  return {
    timezone: group.timezone,
    promptWeekday: group.promptWeekday,
    promptHour: group.promptHour,
    cadenceWeeks: group.cadenceWeeks,
    windowDays: group.windowDays,
    createdAt: group.createdAt,
    lastSlotAt: group.lastSlotAt,
  };
}

/** Guards against a long outage trying to backfill years of issues. */
const MAX_LOOKBACK_STEPS = 26;

function zoned(instant: Date, timezone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.from(instant.toISOString()).toZonedDateTimeISO(timezone);
}

function atHour(day: Temporal.ZonedDateTime, hour: number): Temporal.ZonedDateTime {
  return day.with({ hour, minute: 0, second: 0, millisecond: 0, microsecond: 0, nanosecond: 0 });
}

/** Most recent scheduled occurrence at or before `at`. May predate the loop. */
function occurrenceAtOrBefore(schedule: LoopSchedule, at: Date): Temporal.ZonedDateTime {
  const now = zoned(at, schedule.timezone);
  // Temporal: Monday = 1 … Sunday = 7. Ours: Sunday = 0 … Saturday = 6.
  const weekday = now.dayOfWeek % 7;
  const daysBack = (weekday - schedule.promptWeekday + 7) % 7;
  const candidate = atHour(now.subtract({ days: daysBack }), schedule.promptHour);
  if (Temporal.ZonedDateTime.compare(candidate, now) > 0) {
    return candidate.subtract({ days: 7 });
  }
  return candidate;
}

/**
 * Cadence is phased from the first occurrence on or after the loop was created, so
 * a biweekly loop keeps the same rhythm forever regardless of when you ask.
 */
function anchorOf(schedule: LoopSchedule): Temporal.ZonedDateTime {
  const created = zoned(schedule.createdAt, schedule.timezone);
  const candidate = occurrenceAtOrBefore(schedule, schedule.createdAt);
  if (Temporal.ZonedDateTime.compare(candidate, created) < 0) {
    // The weekly grid, then cadence phases from there.
    return candidate.add({ days: 7 });
  }
  return candidate;
}

function slotIndex(schedule: LoopSchedule, now: Temporal.ZonedDateTime): number {
  const anchor = anchorOf(schedule);
  const daysBetween = Number(anchor.toPlainDate().until(now.toPlainDate()).days);
  const step = 7 * schedule.cadenceWeeks;
  const k = Math.floor(daysBetween / step);
  return Math.max(k, -1);
}

function slotInstant(schedule: LoopSchedule, k: number): Date {
  const anchor = anchorOf(schedule);
  const candidate = anchor.add({ days: k * 7 * schedule.cadenceWeeks });
  return new Date(candidate.toInstant().epochMilliseconds);
}

/**
 * The one slot that should have produced an issue by `at`, or null.
 *
 * Only the most recent missed slot is ever materialized: a newsletter from three
 * weeks ago is not worth sending, so an outage collapses to a single send.
 */
export function dueSlot(schedule: LoopSchedule, at: Date): Date | null {
  const floor = Math.max(
    schedule.createdAt.getTime(),
    schedule.lastSlotAt ? schedule.lastSlotAt.getTime() : 0,
  );
  const now = zoned(at, schedule.timezone);
  let k = slotIndex(schedule, now);
  if (k < 0) return null;
  k = Math.min(k, MAX_LOOKBACK_STEPS);

  // Catch the same-day case where the slot hour has not arrived yet.
  while (k >= 0) {
    const instant = slotInstant(schedule, k);
    if (instant.getTime() > at.getTime()) {
      k -= 1;
      continue;
    }
    if (instant.getTime() <= floor) return null;
    return instant;
  }
  return null;
}

/** The next slot strictly after `at`, for "next send" copy. */
export function nextSlot(schedule: LoopSchedule, at: Date): Date {
  const now = zoned(at, schedule.timezone);
  const k = Math.max(slotIndex(schedule, now), 0);
  const candidate = slotInstant(schedule, k);
  // `slotIndex` counts whole local dates, so `k` is either today's slot (still
  // ahead of us) or the one that already passed — never further behind than that.
  return candidate.getTime() > at.getTime() ? candidate : slotInstant(schedule, k + 1);
}

/**
 * Delivery lands `windowDays` later at the same local wall clock, so a DST
 * change inside the window moves the instant but never the time people see.
 */
export function deliveryInstant(opensAt: Date, schedule: Pick<LoopSchedule, "timezone" | "windowDays">): Date {
  const opened = zoned(opensAt, schedule.timezone);
  return new Date(opened.add({ days: schedule.windowDays }).toInstant().epochMilliseconds);
}

export type Deadline = {
  /** e.g. "Friday 9:00" — always in the loop's timezone. */
  inLoopZone: string;
  /** e.g. "Friday 3:00 am" — the reader's own clock, or null when identical. */
  inViewerZone: string | null;
  loopTimezoneLabel: string;
};

const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function weekdayIn(date: Date, timezone: string): string {
  let formatter = weekdayFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone });
    weekdayFormatters.set(timezone, formatter);
  }
  return formatter.format(date);
}

function timeIn(date: Date, timezone: string): string {
  let formatter = timeFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    });
    timeFormatters.set(timezone, formatter);
  }
  return formatter.format(date);
}

/** Both clocks, because "Friday" is not the same Friday for everyone. */
export function describeDeadline(
  instant: Date,
  loopTimezone: string,
  viewerTimezone?: string | null,
): Deadline {
  const inLoopZone = `${weekdayIn(instant, loopTimezone)} ${timeIn(instant, loopTimezone)}`;
  const inViewerZone =
    viewerTimezone && viewerTimezone !== loopTimezone
      ? `${weekdayIn(instant, viewerTimezone)} ${timeIn(instant, viewerTimezone)}`
      : null;
  return { inLoopZone, inViewerZone, loopTimezoneLabel: loopTimezone };
}

/** 0 = Sunday … 6 = Saturday for a local date, for "is it Friday there?" checks. */
export function weekdayName(weekday: number): string {
  return copy.common.weekdays[weekday] ?? copy.common.weekdays[5];
}

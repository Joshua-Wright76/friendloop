import { Temporal } from "temporal-polyfill";
import { copy } from "./copy.ts";

/**
 * Schedule math. Everything here is pure: callers pass `at` explicitly.
 *
 * A loop's schedule is the moment its issue goes out: a weekday, an hour and a
 * zone, repeating every `cadenceWeeks`. A round is open from one delivery to the
 * next, so the schedule never says when answering starts, only when it ends.
 *
 * It is stored as local wall-clock fields, never as a precomputed future instant,
 * because a DST transition would silently shift a stored instant by an hour.
 * Instants are resolved on demand and frozen only on the issue that is open.
 * (The fields keep their old `prompt*` names from when they opened a round.)
 */
export type LoopSchedule = {
  timezone: string;
  /** Delivery weekday: 0 = Sunday … 6 = Saturday, evaluated in `timezone`. */
  promptWeekday: number;
  /** Delivery hour, local, 0–23. */
  promptHour: number;
  cadenceWeeks: number;
  /** Cadence is phased from the first delivery on or after this. */
  createdAt: Date;
};

/** A group row's schedule fields, in the shape the math above takes. */
export function groupSchedule(group: {
  timezone: string;
  promptWeekday: number;
  promptHour: number;
  cadenceWeeks: number;
  createdAt: Date;
}): LoopSchedule {
  return {
    timezone: group.timezone,
    promptWeekday: group.promptWeekday,
    promptHour: group.promptHour,
    cadenceWeeks: group.cadenceWeeks,
    createdAt: group.createdAt,
  };
}

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
 * The next delivery strictly after `at`. A round that opens now goes out then,
 * however close that is: answers are welcome up to the last moment, and a round
 * with nothing in it simply carries over to the delivery after.
 */
export function nextSlot(schedule: LoopSchedule, at: Date): Date {
  const now = zoned(at, schedule.timezone);
  const k = Math.max(slotIndex(schedule, now), 0);
  const candidate = slotInstant(schedule, k);
  // `slotIndex` counts whole local dates, so `k` is either today's slot (still
  // ahead of us) or the one that already passed — never further behind than that.
  return candidate.getTime() > at.getTime() ? candidate : slotInstant(schedule, k + 1);
}

/**
 * How many deliveries a round has already been carried past with nothing in it:
 * the slots after the one it was opened for, up to its current delivery.
 */
export function carriedOver(schedule: LoopSchedule, round: { slotAt: Date; deliversAt: Date }): number {
  let count = 0;
  let slot = round.slotAt;
  // Bounded: a round is paused long before it could be carried this far.
  while (count < 52) {
    slot = nextSlot(schedule, slot);
    if (slot.getTime() > round.deliversAt.getTime()) break;
    count += 1;
  }
  return count;
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

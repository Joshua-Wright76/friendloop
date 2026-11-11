import { copy, text } from "./copy.ts";

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: timezone });
    cache.set(timezone, formatter);
  }
  return formatter;
}

/** Accepts the Date from a server component or the ISO string from a payload. */
function toDate(instant: Date | string): Date {
  return instant instanceof Date ? instant : new Date(instant);
}

/** "Fri 30 Oct": the day a round went out, in the loop's own zone. */
export function formatDate(instant: Date | string, timezone: string): string {
  try {
    return cached(dateFormatters, timezone, {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(toDate(instant)).replace(",", "");
  } catch {
    return cached(dateFormatters, "UTC", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(toDate(instant)).replace(",", "");
  }
}

/** "Friday 09:00" — the same instant on someone else's clock. */
export function formatTimeInZone(instant: Date | string, timezone: string): string {
  try {
    return cached(timeFormatters, timezone, {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(toDate(instant));
  } catch {
    return cached(timeFormatters, "UTC", {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(toDate(instant));
  }
}

const momentFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * "Thu 12 Nov, 6:03 AM": the one way a moment is written on every surface, so the
 * same round always reads as the same time, with its date attached.
 */
export function formatMoment(instant: Date | string, timezone: string): string {
  const build = (zone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: zone,
    });
  let formatter = momentFormatters.get(timezone);
  if (!formatter) {
    try {
      formatter = build(timezone);
    } catch {
      formatter = build("UTC");
    }
    momentFormatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(toDate(instant)).map((part) => [part.type, part.value]));
  // "Fri, 12:00 AM" reads as all of Friday when it means the end of Thursday, so midnight names the night before.
  if (parts.hour === "12" && parts.minute === "00" && String(parts.dayPeriod).toLowerCase() === "am") {
    const before = Object.fromEntries(formatter.formatToParts(new Date(toDate(instant).getTime() - 60_000)).map((part) => [part.type, part.value]));
    return `end of ${before.weekday} ${before.day} ${before.month}`;
  }
  return `${parts.weekday} ${parts.day} ${parts.month}, ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

/** A moment in a sentence: "at the end of Thu 5 Nov", "on Fri 6 Nov, 9:00 AM". */
export function atMoment(moment: string): string {
  return moment.startsWith("end of") ? `at the ${moment}` : `on ${moment}`;
}

/** "America/Los_Angeles" becomes "Los Angeles": how a person says a place. */
export function timezonePlace(timezone: string): string {
  const city = timezone.split("/").pop() ?? timezone;
  return city.replace(/_/g, " ");
}

/** 9 becomes "9:00 AM", 21 becomes "9:00 PM": hours read the same way as every other time. */
export function formatHour(hour: number): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${hour < 12 ? "AM" : "PM"}`;
}

/** "Sam", "Sam and Alice", "Sam, Alice and Bo". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * A moment on the reader's own clock, and on the loop's when the two differ: the
 * deadline wording every surface shares ("Goes out at the end of Thu 12 Nov your
 * time (Fri 13 Nov, 9:00 AM in Amsterdam)").
 */
export function momentsOf(instant: Date, loopTimezone: string, viewerTimezone: string | null | undefined) {
  // "end of Thu 12 Nov" is the night before midnight; say so, so the clock time is never a guess.
  const clocked = (zone: string) => {
    const moment = formatMoment(instant, zone);
    return moment.startsWith("end of") ? text(copy.loop.momentMidnight, { moment }) : moment;
  };
  // An unlabelled time is a promise that it's the reader's own. If we don't know theirs, name the place.
  if (!viewerTimezone) return { primary: text(copy.loop.momentNamed, { moment: clocked(loopTimezone), place: timezonePlace(loopTimezone) }), loop: null };
  if (viewerTimezone === loopTimezone) return { primary: clocked(loopTimezone), loop: null };
  return {
    primary: text(copy.loop.momentYours, { moment: clocked(viewerTimezone) }),
    loop: text(copy.loop.momentElsewhere, { moment: clocked(loopTimezone), place: timezonePlace(loopTimezone) }),
  };
}

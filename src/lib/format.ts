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

/** "Friday 30 October" — the day a round went out, in the loop's own zone. */
export function formatDate(instant: Date | string, timezone: string): string {
  try {
    return cached(dateFormatters, timezone, {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(toDate(instant));
  } catch {
    return cached(dateFormatters, "UTC", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(toDate(instant));
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

import { copy } from "./copy.ts";

/** A timezone the runtime can actually resolve, so bad input never reaches Temporal. */
export function isValidTimezone(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/**
 * The curated shortlist first (it covers the group the product was built for),
 * then every zone the runtime knows about. A friend in Lisbon or Osaka is no
 * longer stuck with the closest guess.
 */
export function timezoneOptions(): string[] {
  const curated: string[] = copy.common.timezones;
  let supported: string[] = [];
  try {
    const values = (
      Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] }
    ).supportedValuesOf;
    if (typeof values === "function") supported = values.call(Intl, "timeZone");
  } catch {
    // Older runtimes: the curated list is still perfectly usable.
  }

  const extras = supported
    .filter((zone) => !curated.includes(zone))
    .sort((left, right) => left.localeCompare(right));
  return [...curated, ...extras];
}

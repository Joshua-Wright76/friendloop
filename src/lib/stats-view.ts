/** Shared, pure rules for the operations dashboard's reporting window. */

export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

/** Unknown or repeated query values fall back to the useful middle window. */
export function parseStatsRange(value: string | string[] | undefined): StatsRange {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  return STATS_RANGES.includes(parsed as StatsRange) ? (parsed as StatsRange) : 30;
}

/**
 * Whole UTC days, including today. The comparison window immediately precedes it.
 * Day boundaries keep the daily chart and the headline cards in agreement.
 */
export function statsWindow(range: StatsRange, at: Date) {
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
  const start = new Date(end.getTime() - range * 24 * 60 * 60 * 1000);
  const previousStart = new Date(start.getTime() - range * 24 * 60 * 60 * 1000);
  return { start, end, previousStart };
}

/** Null means there was no previous activity to make a percentage meaningful. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

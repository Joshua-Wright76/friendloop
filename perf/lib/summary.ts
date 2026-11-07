import type { Kind, Measured, Run, Sample } from "./types";

/** The numbers are medians across repetitions: one slow frame should not move a score. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const METRICS = [
  "doneMs", "feedbackMs", "interactiveMs", "confirmedMs", "fcpMs", "lcpMs", "cls", "longTaskMs",
  "serverMs", "networkMs", "browserMs", "requests", "bytes", "dbQueries", "dbMs",
] as const;
export type Metric = (typeof METRICS)[number];

export type Row = Omit<Measured, "samples"> & {
  n: number;
  min: number | null;
  max: number | null;
  medians: Record<Metric, number | null>;
  bytesByRole: Record<string, number>;
  detail?: Sample["detail"];
};

export function toRow(entry: Measured): Row {
  const { samples, ...rest } = entry;
  const done = samples.map((sample) => sample.doneMs);
  const medians = Object.fromEntries(METRICS.map((metric) => [
    metric,
    median(samples.flatMap((sample) => (sample[metric] === null ? [] : [sample[metric] as number]))),
  ])) as Record<Metric, number | null>;
  const roles = new Set(samples.flatMap((sample) => Object.keys(sample.bytesByRole)));
  return {
    ...rest,
    n: samples.length,
    min: done.length ? Math.min(...done) : null,
    max: done.length ? Math.max(...done) : null,
    medians,
    bytesByRole: Object.fromEntries([...roles].map((role) => [role, median(samples.map((sample) => sample.bytesByRole[role] ?? 0)) ?? 0])),
    detail: samples.find((sample) => sample.detail)?.detail,
  };
}

export type Score = { mean: number; count: number; failed: number; byKind: Partial<Record<Kind, { mean: number; count: number }>> };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** See perf/README.md: the mean of every interaction's median, on one profile. */
export function scoreOf(rows: Row[], metric: Metric = "doneMs", onlyIds?: Set<string>): Score {
  const included = rows.filter((row) => !onlyIds || onlyIds.has(row.id));
  const valued = included.filter((row) => row.medians[metric] !== null);
  const byKind: Score["byKind"] = {};
  for (const kind of ["page-load", "navigation", "write", "instant"] as const) {
    const values = valued.filter((row) => row.kind === kind).map((row) => row.medians[metric]!);
    if (values.length) byKind[kind] = { mean: mean(values), count: values.length };
  }
  return {
    mean: valued.length ? mean(valued.map((row) => row.medians[metric]!)) : 0,
    count: valued.length,
    failed: included.filter((row) => row.failures.length > 0).length,
    byKind,
  };
}

export function rowsOf(run: Run, profile: string): Row[] {
  return run.results.filter((entry) => entry.profile === profile).map(toRow);
}

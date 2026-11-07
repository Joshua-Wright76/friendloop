#!/usr/bin/env node
/**
 * The loop's working view: the score against the baseline, then what to fix next.
 *
 *   npm run perf:score                         # latest run against the baseline
 *   npm run perf:score -- --run <id> --top 25 --profile desktop
 */
import { parseArgs } from "node:util";
import { readRuns } from "./lib/runs";
import { rowsOf, scoreOf, type Metric, type Row } from "./lib/summary";

const { values: args } = parseArgs({
  options: { run: { type: "string" }, top: { type: "string", default: "25" }, profile: { type: "string", default: "phone-4g" } },
});

const runs = readRuns();
const baseline = runs.find((run) => run.label === "baseline-remeasured" && !run.partial)
  ?? runs.find((run) => run.label === "baseline" && !run.partial);
if (!baseline) throw new Error("No full baseline run in perf/runs");
// By default the newest full run: a partial one compares on a slice and reads as the whole.
const current = args.run
  ? runs.find((run) => run.id.includes(args.run!))
  : [...runs].reverse().find((run) => !run.partial) ?? runs[runs.length - 1];
if (!current) throw new Error("No such run");

const profile = args.profile!;
const before = rowsOf(baseline, profile);
const after = rowsOf(current, profile);
const shared = new Set(after.filter((row) => before.some((other) => other.id === row.id)).map((row) => row.id));
const missing = before.filter((row) => !shared.has(row.id)).length;
const pct = (now: number, then: number) => `${now <= then ? "-" : "+"}${Math.abs((1 - now / then) * 100).toFixed(1)}%`;
const ms = (value: number | null | undefined) => (value === null || value === undefined ? "    -" : `${Math.round(value)}`.padStart(5));

console.log(`${current.id}${current.partial ? " (PARTIAL)" : ""} vs ${baseline.id}, ${profile}, ${shared.size} interactions${missing ? `, ${missing} not in this run` : ""}`);
for (const [metric, name] of [["doneMs", "SCORE done"], ["interactiveMs", "interactive"], ["confirmedMs", "confirmed"], ["longTaskMs", "long tasks"]] as Array<[Metric, string]>) {
  const a = scoreOf(before, metric, shared).mean;
  const b = scoreOf(after, metric, shared).mean;
  console.log(`  ${name.padEnd(12)} ${ms(a)} -> ${ms(b)} ms  ${pct(b, a)}`);
}
const kinds = ["page-load", "navigation", "write", "instant"] as const;
for (const kind of kinds) {
  const a = scoreOf(before, "doneMs", shared).byKind[kind];
  const b = scoreOf(after, "doneMs", shared).byKind[kind];
  if (a && b) console.log(`  ${kind.padEnd(12)} ${ms(a.mean)} -> ${ms(b.mean)} ms  ${pct(b.mean, a.mean)}  (${b.count})`);
}
const failed = after.filter((row) => row.failures.length > 0);
if (failed.length) console.log(`  FAILED: ${failed.map((row) => `${row.id} (${row.failures.length})`).join(", ")}`);

const byId = new Map(before.map((row) => [row.id, row]));
const worst: Row[] = [...after].sort((a, b) => (b.medians.doneMs ?? 0) - (a.medians.doneMs ?? 0)).slice(0, Number(args.top));
console.log(`\n  ${"interaction".padEnd(30)} base   now   srv   net   brw  reqs    KB  qry   int  conf`);
for (const row of worst) {
  const m = row.medians;
  console.log(`  ${row.id.padEnd(30)}${ms(byId.get(row.id)?.medians.doneMs)} ${ms(m.doneMs)} ${ms(m.serverMs)} ${ms(m.networkMs)} ${ms(m.browserMs)} ${ms(m.requests)} ${ms((m.bytes ?? 0) / 1024)} ${ms(m.dbQueries)} ${ms(m.interactiveMs)} ${ms(m.confirmedMs)}`);
}

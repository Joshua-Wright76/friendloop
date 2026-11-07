#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { coverage } from "./coverage";
import { rowsOf, scoreOf, toRow } from "./summary";
import { readRuns } from "./runs";

/**
 * One self-contained HTML file: no server, nothing to install, works from a file://
 * link. Every run's numbers are embedded; per-request and per-query detail is kept for
 * the baseline and the latest run only, which is what keeps the file a sensible size.
 */
export function renderDashboard(): string {
  const root = process.cwd();
  const runs = readRuns(root);
  if (runs.length === 0) throw new Error("No runs in perf/runs");
  const baseline = runs.find((run) => run.label === "baseline-remeasured" && !run.partial)
    ?? runs.find((run) => run.label === "baseline" && !run.partial);
  const original = runs.find((run) => run.label === "baseline" && !run.partial);
  const latest = runs[runs.length - 1];
  const latestFull = [...runs].reverse().find((run) => !run.partial);

  const embedded = runs.map((run) => {
    const keepDetail = run === baseline || run === original || run === latest || run === latestFull;
    return {
      id: run.id,
      label: run.label,
      createdAt: run.createdAt,
      git: run.git,
      partial: run.partial,
      config: run.config,
      machine: run.machine,
      durationSec: run.durationSec,
      scores: Object.fromEntries(run.config.profiles.map((profile) => [profile.id, scoreOf(rowsOf(run, profile.id))])),
      rows: run.results.map((entry) => {
        const row = toRow(entry);
        if (!keepDetail) delete row.detail;
        return row;
      }),
    };
  });

  const template = readFileSync(path.join(root, "perf", "lib", "dashboard.template.html"), "utf8");
  // In a script element, only a closing tag or a comment opener can end it early.
  const json = JSON.stringify({ runs: embedded, coverage: coverage() }).replace(/</g, "\\u003c");
  const out = path.join(root, "perf", "dashboard");
  mkdirSync(out, { recursive: true });
  const file = path.join(out, "index.html");
  writeFileSync(file, template.replace("/*__DATA__*/", () => json));
  return file;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(renderDashboard());
}

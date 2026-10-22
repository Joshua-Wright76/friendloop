#!/usr/bin/env node
/**
 * Keeps "100% of flows covered by e2e tests" true instead of aspirational.
 *
 *   node scripts/check-flows.mjs           # every `done` flow has a spec, no orphan specs
 *   node scripts/check-flows.mjs --strict  # additionally: no flow may still be `todo`
 *
 * The release workflow runs --strict, so nothing ships at less than full coverage.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const SPEC_DIR = "e2e/flows";
const FLOW_DOC = "specs/flows.md";
const strict = process.argv.includes("--strict");

if (!existsSync(FLOW_DOC)) {
  console.error(`✖ ${FLOW_DOC} is missing — the flow inventory is the source of truth.`);
  process.exit(1);
}

const rows = readFileSync(FLOW_DOC, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => /^\|\s*[A-G]\d+\s*\|/.test(line))
  .map((line) => {
    const cells = line.split("|").map((cell) => cell.trim());
    return { id: cells[1], name: cells[2], criteria: cells[3], status: cells[4] };
  });

if (rows.length === 0) {
  console.error("✖ No flows parsed from specs/flows.md — the table format changed.");
  process.exit(1);
}

const seen = new Set();
const duplicate = [];
for (const row of rows) {
  if (seen.has(row.id)) duplicate.push(row.id);
  seen.add(row.id);
}

const specFiles = existsSync(SPEC_DIR)
  ? readdirSync(SPEC_DIR).filter((file) => file.endsWith(".spec.ts"))
  : [];
const specIds = new Set(specFiles.map((file) => file.replace(/\.spec\.ts$/, "")));

const problems = [];
const todo = [];
const done = [];

for (const row of rows) {
  if (!row.status || !["todo", "done"].includes(row.status)) {
    problems.push(`${row.id}: status must be "todo" or "done" (found "${row.status ?? ""}")`);
    continue;
  }
  if (row.status === "done") {
    done.push(row.id);
    if (!specIds.has(row.id)) problems.push(`${row.id} is marked done but ${SPEC_DIR}/${row.id}.spec.ts is missing`);
  } else {
    todo.push(row.id);
    if (strict) problems.push(`${row.id} is still todo — --strict requires every flow to be built and covered`);
  }
  if (!row.criteria || row.criteria.length < 20) {
    problems.push(`${row.id} has no meaningful acceptance criteria`);
  }
}

for (const id of specIds) {
  if (!seen.has(id)) problems.push(`${SPEC_DIR}/${id}.spec.ts has no flow in ${FLOW_DOC}`);
}

for (const id of duplicate) problems.push(`${id} appears more than once in ${FLOW_DOC}`);

const pct = rows.length === 0 ? 0 : Math.round((done.length / rows.length) * 100);
console.log(
  `flows: ${rows.length} total · ${done.length} done · ${todo.length} todo · ${pct}% covered`,
);

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exit(1);
}

console.log(`✓ flow matrix is consistent${strict ? " (strict)" : ""}`);

#!/usr/bin/env node
/**
 * Keeps the truncate list in step with the schema.
 *
 * `resetDatabase()` empties tables it names by hand. A migration that adds one
 * without touching that list leaks rows into the next test — intermittently, and
 * only once something starts asserting on them. This fails instead.
 */
import { readFileSync, existsSync } from "node:fs";

const SCHEMA = "src/db/schema.ts";
const HARNESS = "e2e/support/db.ts";

for (const file of [SCHEMA, HARNESS]) {
  if (!existsSync(file)) {
    console.error(`✖ ${file} is missing`);
    process.exit(1);
  }
}

const schema = readFileSync(SCHEMA, "utf8");
const tables = [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((match) => match[1]);

const harness = readFileSync(HARNESS, "utf8");
const block = /const TABLES = \[([\s\S]*?)\];/.exec(harness);
if (!block) {
  console.error(`✖ Could not find the TABLES list in ${HARNESS}`);
  process.exit(1);
}
const listed = [...block[1].matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);

const missing = tables.filter((table) => !listed.includes(table));
const stale = listed.filter((table) => !tables.includes(table));
const problems = [
  ...missing.map((table) => `${table} is in the schema but not in ${HARNESS} — resetDatabase() would leak its rows`),
  ...stale.map((table) => `${table} is truncated but no longer in the schema`),
];

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exit(1);
}

console.log(`✓ ${listed.length} tables truncated, ${tables.length} in the schema`);

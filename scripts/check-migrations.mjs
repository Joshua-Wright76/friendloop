#!/usr/bin/env node
/**
 * Rollback reverts code, not the database. A destructive migration in the same
 * release makes `POST /v1/projects/{id}/rollback/...` decorative, so this fails CI
 * unless the migration is explicitly allowed for a deliberate contract phase.
 *
 * Allowed escape hatch, in the migration that does it on purpose:
 *   -- expand-contract: yes  (old column no longer read by any deployed code)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = "drizzle";
const DESTRUCTIVE = [
  { pattern: /\bdrop\s+table\b/i, label: "DROP TABLE" },
  { pattern: /\bdrop\s+column\b/i, label: "DROP COLUMN" },
  { pattern: /\btruncate\b/i, label: "TRUNCATE" },
  { pattern: /\brename\s+(to|column)\b/i, label: "RENAME" },
  { pattern: /\balter\s+column\s+\S+\s+(set\s+not\s+null|type)\b/i, label: "ALTER COLUMN type/NOT NULL" },
];

if (!existsSync(DIR)) {
  console.log("✓ no migrations yet");
  process.exit(0);
}

const files = readdirSync(DIR).filter((file) => file.endsWith(".sql"));
const problems = [];

for (const file of files) {
  const raw = readFileSync(join(DIR, file), "utf8");
  const allowed = /--\s*expand-contract:\s*yes/i.test(raw);
  const body = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  for (const rule of DESTRUCTIVE) {
    if (rule.pattern.test(body)) {
      if (allowed) continue;
      problems.push(`${DIR}/${file} contains ${rule.label}`);
    }
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  console.error(
    "\nDestructive DDL needs two releases: ship the code that stops using it first,\n" +
      "then drop it in a follow-up. Add `-- expand-contract: yes` to the migration\n" +
      "only when no deployed code reads the thing you are removing.",
  );
  process.exit(1);
}

console.log(`✓ ${files.length} migration(s) are rollback-safe`);

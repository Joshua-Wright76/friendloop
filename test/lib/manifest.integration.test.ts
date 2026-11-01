import { test } from "node:test";
import { setupDatabase } from "../support/app.ts";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Every module in `src/lib` has to load under the test harness.
 *
 * V8 coverage only reports files that were loaded, so a new module that no test
 * imports is invisible — a 100% report that quietly stops covering the code it
 * was written for. Importing all of them here makes that impossible: a module
 * either loads (and is measured) or fails this test.
 */
const LIB = path.resolve(import.meta.dirname, "..", "..", "src", "lib");

function modules(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return modules(full);
    if (!entry.name.endsWith(".ts")) return [];
    if (entry.name.includes(".test.")) return [];
    return [full];
  });
}


setupDatabase();

test("every src/lib module loads in the test harness", async () => {
  const files = modules(LIB);
  assert.ok(files.length > 20, "the walker found the library");

  const failures: string[] = [];
  for (const file of files) {
    try {
      await import(pathToFileURL(file).href);
    } catch (error) {
      failures.push(`${path.relative(LIB, file)}: ${(error as Error).message}`);
    }
  }

  assert.deepEqual(failures, [], "a module that cannot load is a module that is not covered");
});

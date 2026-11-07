import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { Run } from "./types";

/** Every saved run, oldest first. Runs are stored gzipped; plain JSON still reads. */
export function readRuns(root: string = process.cwd()): Run[] {
  const directory = path.join(root, "perf", "runs");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json") || file.endsWith(".json.gz"))
    .sort()
    .map((file) => {
      const bytes = readFileSync(path.join(directory, file));
      return JSON.parse((file.endsWith(".gz") ? gunzipSync(bytes) : bytes).toString("utf8")) as Run;
    });
}

#!/usr/bin/env node
/**
 *   npm-free entry:  recordings/rec.sh --shard 0 --viewport desktop --only A1,A2
 * Options: --shard k | --viewport desktop|mobile|both | --only A1,A2 | --kind flows|journeys|all
 *          --skip-existing (leave takes that already passed)
 */
import { parseArgs } from "node:util";
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RECORDINGS, Take, stackFor } from "./lib/harness.mjs";

const { values } = parseArgs({ options: {
  shard: { type: "string", default: "0" }, viewport: { type: "string", default: "both" },
  only: { type: "string" }, kind: { type: "string", default: "all" }, "skip-existing": { type: "boolean", default: false },
} });
const shard = Number(values.shard);
const stack = stackFor(shard);
const only = values.only ? new Set(values.only.split(",").map((id) => id.trim())) : null;
const viewports = values.viewport === "both" ? ["desktop", "mobile"] : [values.viewport];
const { resetDatabase, migrate, resetSchema } = await import("../e2e/support/db.ts");

async function load(kind) {
  const directory = path.join(RECORDINGS, kind);
  const out = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".mjs")).sort()) {
    const module = await import(pathToFileURL(path.join(directory, file)).href);
    for (const [id, flow] of Object.entries(module.flows)) out.push({ id, kind, ...flow });
  }
  return out;
}
const kinds = values.kind === "all" ? ["flows", "journeys"] : [values.kind];
let takes = [];
for (const kind of kinds) takes.push(...(await load(kind)));
if (only) takes = takes.filter((flow) => only.has(flow.id));

await resetSchema();
await migrate();

const summary = [];
for (const flow of takes) {
  for (const viewport of viewports) {
    const outputDir = path.join(RECORDINGS, "output", flow.kind, viewport);
    mkdirSync(outputDir, { recursive: true });
    const manifestPath = path.join(outputDir, `${flow.id}.json`);
    if (values["skip-existing"] && existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, "utf8")).status === "pass") continue;
    await resetDatabase();
    await fetch(`${stack.mailpit}/api/v1/messages`, { method: "DELETE" });
    const take = new Take({ id: flow.id, title: flow.title, viewport, stack, outputDir, session: `flrec-${shard}` });
    let status = "pass";
    let error = null;
    const began = Date.now();
    try {
      await take.start();
      const data = flow.seed ? await flow.seed(take) : undefined;
      await take.record();
      await flow.run(take, data);
      await take.pause(1000);
    } catch (failure) {
      status = "fail";
      error = String(failure?.message ?? failure);
    } finally {
      await take.stop().catch((failure) => { status = "fail"; error ??= String(failure); });
    }
    const manifest = {
      id: flow.id, kind: flow.kind, viewport, title: flow.title, area: flow.area ?? null, status, error,
      steps: take.steps, notes: take.notes, staged: flow.staged ?? null, consoleErrors: take.consoleErrors ?? "",
      seconds: Math.round((Date.now() - began) / 1000),
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    summary.push(manifest);
    console.log(`${status === "pass" ? "PASS" : "FAIL"} ${flow.id} ${viewport} ${manifest.seconds}s${error ? ` — ${error}` : ""}`);
  }
}
const failed = summary.filter((item) => item.status !== "pass");
console.log(`\n${summary.length - failed.length}/${summary.length} passed`);
process.exit(failed.length ? 1 : 0);

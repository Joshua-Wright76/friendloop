#!/usr/bin/env node
/**
 * The performance lab: a production build, a seeded six-month-old loop, a database
 * with a real round trip, and a throttled browser timing every interaction.
 *
 *   npm run perf -- --label baseline
 *   npm run perf -- --only 'reply\.' --reps 3 --no-build
 *
 * See perf/README.md for what the numbers mean.
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, X509Certificate } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { cpus, homedir, loadavg } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { startDbProxy } from "./lib/db-proxy";
import { startEdge } from "./lib/edge";
import { probe, type DoneSpec, type ProbeResult } from "./lib/probe";
import { PROFILES, type Profile } from "./lib/profiles";
import type { Ctx, Interaction, Measured, RequestRecord, Run, Sample, Viewer } from "./lib/types";
import { buildWorld, type World } from "./lib/world";
import { renderDashboard } from "./lib/dashboard";

const { values: args } = parseArgs({
  options: {
    label: { type: "string", default: "run" },
    reps: { type: "string", default: "5" },
    only: { type: "string" },
    profile: { type: "string" },
    "no-build": { type: "boolean", default: false },
    "keep-going": { type: "boolean", default: true },
    /** Diagnosis only: a Chrome trace of the last repetition, summarised by kind of work. */
    trace: { type: "boolean", default: false },
  },
});

const ROOT = process.cwd();
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3197);
const SINK_PORT = APP_PORT + 1;
const SERVER_PORT = APP_PORT + 2;
const DB_PORT = process.env.PERF_DB_PORT ?? "55499";
const DB_DIR = path.join(homedir(), "Library", "Caches", "friendloop-perf");
/** What a pooled Neon connection in the same region costs; an assumption, and stated on the dashboard. */
const DB_ROUND_TRIP_MS = 10;
const TMP = path.join(ROOT, "perf", ".tmp");
const APP = `https://localhost:${APP_PORT}`;
const REPS = Number(args.reps);
const DONE_TIMEOUT_MS = 20_000;
const SESSION_COOKIE = "fl_session";

mkdirSync(TMP, { recursive: true });
const serverLog = path.join(TMP, "server.log");
const log = (line: string) => console.error(`[perf] ${line}`);

const databaseEnv = { E2E_DB_PORT: DB_PORT, E2E_DB_DIR: DB_DIR };
const DIRECT_URL = `postgresql://postgres@127.0.0.1:${DB_PORT}/friendloop_test`;

function startDatabase() {
  execFileSync("node", ["scripts/e2e-db.mjs", "start"], { env: { ...process.env, ...databaseEnv }, stdio: "ignore" });
}

const buildEnv = {
  // The lab builds as production is built. The DSN points at a local sink so the
  // Sentry SDK starts, traces and sends exactly as it does for real visitors.
  NEXT_PUBLIC_APP_URL: APP,
  NEXT_PUBLIC_SENTRY_DSN: `http://perflab@127.0.0.1:${SINK_PORT}/1`,
};

function build() {
  log("building (rm -rf .next first: a reused one can miss CSS edits)");
  rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  execFileSync("npx", ["next", "build"], {
    env: { ...process.env, ...buildEnv, DATABASE_URL: DIRECT_URL, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "inherit"],
  });
}

function startSink() {
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" });
      response.end("{}");
    });
  });
  return new Promise<typeof server>((resolve) => server.listen(SINK_PORT, "127.0.0.1", () => resolve(server)));
}

async function startApp(databasePort: number): Promise<ChildProcess> {
  const child = spawn("npx", ["next", "start", "-p", String(SERVER_PORT)], {
    env: {
      ...process.env,
      ...buildEnv,
      NODE_ENV: "production",
      DATABASE_URL: `postgresql://postgres@127.0.0.1:${databasePort}/friendloop_test`,
      // E2E=1 only for what it does here: photos on local disk instead of Blob.
      // The lab never sends the x-e2e-* headers it would otherwise honour.
      E2E: "1",
      E2E_APP_URL: APP,
      EMAIL_TRANSPORT: "outbox",
      CRON_SECRET: "perf-cron-secret",
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk) => appendFileSync(serverLog, chunk));
  child.stderr?.on("data", (chunk) => appendFileSync(serverLog, chunk));
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/healthz`);
      if (response.status < 500) return child;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The app never came up; see ${serverLog}`);
}

/** Watches the network for one page: what ran, how long, how big, and whether it is quiet. */
class Tracker {
  private records = new Map<string, RequestRecord & { start: number; mono: number; wait: [number, number] | null; prefetch: boolean }>();
  private order: string[] = [];
  private inflight = new Set<string>();
  lastActivity = Date.now();
  latencyMs: number;

  constructor(cdp: CDPSession, latencyMs: number) {
    this.latencyMs = latencyMs;
    cdp.on("Network.requestWillBeSent", (event) => {
      if (event.request.url.startsWith("data:") || event.request.url.startsWith("blob:")) return;
      const url = new URL(event.request.url);
      if (url.port === String(SINK_PORT)) return;
      const headers = Object.fromEntries(Object.entries(event.request.headers).map(([key, value]) => [key.toLowerCase(), value]));
      const prefetch = "next-router-prefetch" in headers || event.request.headers.purpose === "prefetch";
      const role: RequestRecord["role"] = prefetch ? "prefetch"
        : "next-action" in headers ? "action"
        : "rsc" in headers || url.searchParams.has("_rsc") ? "rsc"
        : event.type === "Document" ? "document"
        : "asset";
      this.records.set(event.requestId, {
        path: url.pathname, type: event.type ?? "Other", role, status: 0, bytes: 0,
        startMs: 0, waitMs: 0, endMs: 0,
        start: event.wallTime * 1000, mono: event.timestamp, wait: null, prefetch,
      });
      this.order.push(event.requestId);
      this.inflight.add(event.requestId);
      this.lastActivity = Date.now();
    });
    cdp.on("Network.responseReceived", (event) => {
      const record = this.records.get(event.requestId);
      if (!record) return;
      record.status = event.response.status;
      const timing = event.response.timing;
      if (timing) {
        const base = record.start + (timing.requestTime - record.mono) * 1000;
        record.wait = [base + timing.sendEnd, base + timing.receiveHeadersEnd];
      }
    });
    const finish = (requestId: string, timestamp: number, bytes: number) => {
      const record = this.records.get(requestId);
      if (!record) return;
      record.endMs = record.start + (timestamp - record.mono) * 1000;
      record.bytes = bytes;
      this.inflight.delete(requestId);
      this.lastActivity = Date.now();
    };
    cdp.on("Network.loadingFinished", (event) => finish(event.requestId, event.timestamp, event.encodedDataLength));
    cdp.on("Network.loadingFailed", (event) => finish(event.requestId, event.timestamp, 0));
  }

  reset() {
    this.records.clear();
    this.order = [];
  }

  /** Nothing moving for `quietMs`, or give up at `maxMs` and say so by returning. */
  async quiet(quietMs: number, maxMs: number) {
    const began = Date.now();
    while (Date.now() - began < maxMs) {
      if (this.inflight.size === 0 && Date.now() - this.lastActivity >= quietMs) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  summarize(t0: number, done: number) {
    const all = this.order.map((id) => this.records.get(id)!).filter((record) => record.start >= t0 - 20 && record.start <= done + 2000);
    const finished = all.map((record) => ({ ...record, end: record.endMs || done }));
    const urgent = finished.filter((record) => !record.prefetch);

    const union = (intervals: Array<[number, number]>) => {
      const clipped = intervals
        .map(([a, b]): [number, number] => [Math.max(a, t0), Math.min(b, done)])
        .filter(([a, b]) => b > a)
        .sort((a, b) => a[0] - b[0]);
      let total = 0;
      let cursor = t0;
      for (const [a, b] of clipped) {
        const start = Math.max(a, cursor);
        if (b > start) { total += b - start; cursor = b; }
      }
      return total;
    };
    const serverMs = union(urgent.flatMap((record): Array<[number, number]> => record.wait
      ? [[Math.min(record.wait[0] + this.latencyMs, record.wait[1]), record.wait[1]]]
      : []));
    const busyMs = union(urgent.map((record): [number, number] => [record.start, record.end]));
    const totalMs = done - t0;
    const onServer = urgent.filter((record) => record.role === "document" || record.role === "rsc" || record.role === "action");
    const confirmed = Math.max(done, ...onServer.map((record) => record.end));
    const bytesByRole: Record<string, number> = {};
    for (const record of finished) {
      const bucket = record.role === "asset" ? record.type.toLowerCase() : record.role;
      bytesByRole[bucket] = (bytesByRole[bucket] ?? 0) + record.bytes;
    }
    return {
      serverMs,
      networkMs: Math.max(0, busyMs - serverMs),
      browserMs: Math.max(0, totalMs - busyMs),
      confirmedMs: confirmed - t0,
      requests: finished.filter((record) => record.bytes > 0).length,
      bytes: finished.reduce((sum, record) => sum + record.bytes, 0),
      bytesByRole,
      detail: finished.map((record): RequestRecord => ({
        path: record.path, type: record.type, role: record.role, status: record.status, bytes: record.bytes,
        startMs: Math.round(record.start - t0),
        waitMs: record.wait ? Math.round(record.wait[1] - record.wait[0]) : 0,
        endMs: Math.round(record.end - t0),
      })),
    };
  }
}

async function preparePage(context: BrowserContext, profile: Profile, coldSpec: DoneSpec | null) {
  const page = await context.newPage();
  // A first visit on a throttled phone can be slow to fire `load`; that is a finding, not a failure.
  page.setDefaultNavigationTimeout(90_000);
  page.setDefaultTimeout(DONE_TIMEOUT_MS);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuSlowdown });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: (profile.downKbps * 1024) / 8,
    uploadThroughput: (profile.upKbps * 1024) / 8,
  });
  await page.addInitScript(probe, coldSpec);
  return { page, tracker: new Tracker(cdp, profile.latencyMs), cdp };
}

async function newContext(browser: Browser, profile: Profile, world: World, viewer: Viewer) {
  const context = await browser.newContext({ ...profile.context, baseURL: APP, serviceWorkers: "block", ignoreHTTPSErrors: true });
  const person = viewer === "owner" ? world.owner : viewer === "member" ? world.member : null;
  if (person) await context.addCookies([{ name: SESSION_COOKIE, value: person.sessionToken, url: APP }]);
  return context;
}

async function measureOnce(
  browser: Browser,
  world: World,
  profile: Profile,
  interaction: Interaction,
  warmContexts: Map<string, BrowserContext>,
  proxy: Awaited<ReturnType<typeof startDbProxy>>,
  rep: number,
): Promise<Sample> {
  await world.query("delete from rate_limits");
  const isLoad = interaction.kind === "page-load";
  const fresh = isLoad && (interaction.cache ?? "empty") === "empty";
  let context: BrowserContext;
  if (fresh) context = await newContext(browser, profile, world, interaction.viewer);
  else {
    const key = `${profile.id}:${interaction.viewer}`;
    if (!warmContexts.has(key)) warmContexts.set(key, await newContext(browser, profile, world, interaction.viewer));
    context = warmContexts.get(key)!;
    // "anon" means no session: a sign-in sample must not leave later samples signed in.
    if (interaction.viewer === "anon") await context.clearCookies();
  }

  const makeCtx = (page: Page): Ctx => ({
    page, context, world, profile, viewer: interaction.viewer,
    unique: `${Date.now().toString(36)}${rep}`,
    async visit(target) { await page.goto(target, { waitUntil: "commit", timeout: DONE_TIMEOUT_MS }); },
    async startClock() { await page.evaluate(() => (window as unknown as { __perf: { start(): void } }).__perf.start()); },
  });

  if (isLoad && interaction.cache === "warm") {
    const primer = await context.newPage();
    primer.setDefaultNavigationTimeout(90_000);
    const ctx = makeCtx(primer);
    await interaction.prepare?.(ctx);
    await interaction.act(ctx);
    await primer.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await primer.close();
  }

  const scratch = makeCtx(null as unknown as Page);
  const spec = interaction.done(scratch);
  const { page, tracker } = await preparePage(context, profile, isLoad ? spec : null);
  const ctx: Ctx = { ...makeCtx(page), unique: scratch.unique };

  try {
    await interaction.prepare?.(ctx);
    if (!isLoad) {
      await page.waitForLoadState("load", { timeout: 20_000 });
      // A person's eyes take longer than this; prefetches have landed by then.
      await tracker.quiet(350, 5000);
      await page.evaluate(([doneSpec]) => (window as unknown as { __perf: { arm(s: unknown, l: boolean): void } }).__perf.arm(doneSpec, false), [spec]);
      const early = await page.evaluate(() => (window as unknown as { __perf: { alreadyDone(): boolean } }).__perf.alreadyDone());
      if (early) throw new Error(`"${spec.selector}" ${spec.text ? `with "${spec.text}" ` : ""}already matches before the gesture: the number would be fake`);
    }
    proxy.drain();
    tracker.reset();

    const tracing = args.trace && rep === REPS;
    if (tracing) {
      await browser.startTracing(page, {
        categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8.execute", "blink.user_timing"],
      });
    }
    await interaction.act(ctx);

    const began = Date.now();
    let result: ProbeResult | null = null;
    while (Date.now() - began < DONE_TIMEOUT_MS) {
      result = await page
        .evaluate(() => (window as unknown as { __perf?: { result(): ProbeResult } }).__perf?.result() ?? null)
        .catch(() => null);
      const hydrating = isLoad && result?.done && !result.interactive && Date.now() - began < DONE_TIMEOUT_MS;
      if (result?.done && !hydrating) break;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (!result?.done || !result.t0) {
      const shot = path.join(TMP, `fail-${interaction.id}-${profile.id}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      throw new Error(`"${spec.selector}" ${spec.text ? `with "${spec.text}" ` : ""}never appeared (${page.url()}); see ${shot}`);
    }

    if (tracing) await writeTraceSummary(await browser.stopTracing(), interaction.id, profile.id, result);
    await tracker.quiet(300, 4000);
    const queries = proxy.drain();
    const summary = tracker.summarize(result.t0, result.done);
    return {
      doneMs: result.done - result.t0,
      feedbackMs: result.feedback ? result.feedback - result.t0 : null,
      interactiveMs: result.interactive ? result.interactive - result.t0 : null,
      confirmedMs: summary.confirmedMs,
      fcpMs: isLoad ? result.fcp : null,
      lcpMs: isLoad ? result.lcp : null,
      cls: result.cls,
      longTaskMs: result.longTaskMs,
      serverMs: summary.serverMs,
      networkMs: summary.networkMs,
      browserMs: summary.browserMs,
      requests: summary.requests,
      bytes: summary.bytes,
      bytesByRole: summary.bytesByRole,
      dbQueries: queries.length,
      dbMs: queries.reduce((sum, query) => sum + query.ms, 0),
      detail: {
        requests: summary.detail,
        queries: queries.map((query) => ({ sql: query.sql.slice(0, 200), ms: Math.round(query.ms * 10) / 10 })),
      },
    };
  } catch (error) {
    // A prepare or act that never got as far as waiting for `done` deserves a picture too.
    await page.screenshot({ path: path.join(TMP, `fail-${interaction.id}-${profile.id}.png`) }).catch(() => {});
    throw error;
  } finally {
    await page.close().catch(() => {});
    if (fresh) await context.close().catch(() => {});
  }
}

/** The main thread's work between the input and the result, by kind. Written to perf/.tmp/trace-*.txt. */
async function writeTraceSummary(buffer: Buffer, id: string, profileId: string, result: ProbeResult) {
  const { writeFileSync: write } = await import("node:fs");
  const trace = JSON.parse(buffer.toString()) as { traceEvents: Array<{ name: string; ph: string; ts: number; dur?: number; tid: number; pid: number; args?: { data?: { url?: string; functionName?: string } } }> };
  const events = trace.traceEvents;
  const main = events.find((event) => event.name === "thread_name" && (event.args as { name?: string } | undefined)?.name === "CrRendererMain");
  const onMain = events.filter((event) => event.ph === "X" && event.dur && (!main || (event.tid === main.tid && event.pid === main.pid)));
  const totals = new Map<string, number>();
  const scripts = new Map<string, number>();
  for (const event of onMain) {
    if (["RunTask", "ThreadControllerImpl::RunTask"].includes(event.name)) continue;
    totals.set(event.name, (totals.get(event.name) ?? 0) + event.dur! / 1000);
    const url = event.args?.data?.url;
    if (url && (event.name === "FunctionCall" || event.name === "EvaluateScript" || event.name === "v8.compile")) {
      const key = `${event.name} ${url.replace(/^https:\/\/localhost:\d+/, "")}${event.args?.data?.functionName ? ` ${event.args.data.functionName}` : ""}`;
      scripts.set(key, (scripts.get(key) ?? 0) + event.dur! / 1000);
    }
  }
  const lines = [
    `${id} on ${profileId}: done ${Math.round((result.done ?? 0) - (result.t0 ?? 0))} ms (times include nesting, so they overlap)`,
    "", "By event:",
    ...[...totals].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => `  ${ms.toFixed(1).padStart(8)} ms  ${name}`),
    "", "By script:",
    ...[...scripts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, ms]) => `  ${ms.toFixed(1).padStart(8)} ms  ${name}`),
  ];
  write(path.join(TMP, `trace-${id}-${profileId}.txt`), lines.join("\n"));
}

function gitInfo() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim();
  const dirtyFiles = execFileSync("git", ["status", "--porcelain"]).toString().split("\n").filter(Boolean).length;
  return { sha, dirtyFiles };
}

async function main() {
  // Before importing anything that reads it: the seed talks straight to Postgres.
  process.env.DATABASE_URL = DIRECT_URL;
  process.env.TEST_DATABASE_URL = DIRECT_URL;
  const { INTERACTIONS } = await import("./interactions/index");
  const { resetSchema, migrate } = await import("../e2e/support/db");

  const git = gitInfo();
  const only = args.only ? new RegExp(args.only) : null;
  const catalog = INTERACTIONS.filter((interaction) => !only || only.test(interaction.id));
  const profiles = PROFILES.filter((profile) => !args.profile || args.profile.split(",").includes(profile.id));
  if (catalog.length === 0) throw new Error("No interaction matches");

  startDatabase();
  await resetSchema();
  await migrate(DIRECT_URL);
  if (!args["no-build"]) build();

  const proxy = await startDbProxy({ targetPort: Number(DB_PORT), roundTripMs: DB_ROUND_TRIP_MS });
  const sink = await startSink();
  rmSync(serverLog, { force: true });
  const app = await startApp(proxy.port);
  const edge = await startEdge({ port: APP_PORT, targetPort: SERVER_PORT, certDirectory: TMP });
  // Chromium keeps nothing in its HTTP cache from a site whose certificate had an error, so
  // `ignoreHTTPSErrors` alone would make every "warm" load a cold one. Trust this one key instead.
  const edgeKey = new X509Certificate(readFileSync(path.join(TMP, "edge.crt"))).publicKey.export({ type: "spki", format: "der" });
  const browser = await chromium.launch({
    headless: true,
    args: [`--ignore-certificate-errors-spki-list=${createHash("sha256").update(edgeKey).digest("base64")}`],
  });
  const startedAt = Date.now();
  const loadBefore = loadavg()[0];
  const stop = async () => {
    await browser.close().catch(() => {});
    try { if (app.pid) process.kill(-app.pid, "SIGTERM"); } catch { /* gone */ }
    sink.close();
    await edge.close();
    await proxy.close();
  };

  try {
    log("seeding");
    const world = await buildWorld({ app: APP, browser });
    const results: Measured[] = [];

    for (const profile of profiles) {
      const warm = new Map<string, BrowserContext>();
      for (const [index, interaction] of catalog.entries()) {
        const entry: Measured = {
          id: interaction.id, label: interaction.label, surface: interaction.surface, kind: interaction.kind,
          viewer: interaction.viewer, flows: interaction.flows, routes: interaction.routes, cache: interaction.cache,
          profile: profile.id, failures: [], samples: [],
        };
        // Repetition 0 warms the server and the page's route, and is thrown away.
        for (let rep = 0; rep <= REPS; rep++) {
          try {
            // A sample that hangs is a failure, not a stalled run.
            const sample = await Promise.race([
              measureOnce(browser, world, profile, interaction, warm, proxy, rep),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sample took over 90 s")), 90_000).unref()),
            ]);
            if (rep > 0) entry.samples.push(sample);
          } catch (error) {
            const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
            if (rep > 0 || REPS === 0) entry.failures.push(message);
            else log(`  warm-up failed: ${message}`);
          }
        }
        results.push(entry);
        const sorted = entry.samples.map((sample) => sample.doneMs).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        log(`${profile.id} ${String(index + 1).padStart(3)}/${catalog.length} ${interaction.id.padEnd(34)} ${median === undefined ? "FAILED" : `${Math.round(median)}ms`}${entry.failures.length ? ` (${entry.failures.length} failed: ${entry.failures[0]})` : ""}`);
      }
      for (const context of warm.values()) await context.close();
    }

    // Keep the detail of one median-ish sample per interaction; the rest is just numbers.
    for (const entry of results) {
      const sorted = [...entry.samples].sort((a, b) => a.doneMs - b.doneMs);
      const middle = sorted[Math.floor(sorted.length / 2)];
      for (const sample of entry.samples) if (sample !== middle) delete sample.detail;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const run: Run = {
      id: `${stamp}-${args.label!.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      label: args.label!,
      createdAt: new Date().toISOString(),
      git,
      // A run where some interaction produced nothing at all is not a full picture, whatever it was asked for.
      partial: Boolean(only) || profiles.length !== PROFILES.length || results.some((entry) => entry.samples.length === 0),
      config: {
        reps: REPS,
        dbRoundTripMs: DB_ROUND_TRIP_MS,
        profiles: profiles.map(({ id, label, cpuSlowdown, latencyMs, downKbps, upKbps }) => ({ id, label, cpuSlowdown, latencyMs, downKbps, upKbps })),
      },
      machine: { cpus: cpus().length, loadBefore, loadAfter: loadavg()[0] },
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      results,
    };
    mkdirSync(path.join(ROOT, "perf", "runs"), { recursive: true });
    // Gzipped: a full run is about 3 MB of JSON and a tenth of that compressed.
    writeFileSync(path.join(ROOT, "perf", "runs", `${run.id}.json.gz`), gzipSync(JSON.stringify(run)));
    const dashboard = renderDashboard();
    log(`wrote perf/runs/${run.id}.json.gz in ${run.durationSec}s; dashboard: ${dashboard}`);
  } finally {
    await stop();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});

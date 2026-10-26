#!/usr/bin/env node
/**
 * A disposable Postgres for the Playwright suite.
 *
 *   npm run e2e              # starts this database if needed, then runs the suite
 *   npm run e2e:db:stop      # stops it (the data directory is kept)
 *   npm run e2e:db:reset     # wipes and rebuilds it
 *
 * The cluster lives in the OS cache directory — never inside the repository,
 * where Turbopack would try to read its Unix socket during `next build` — and
 * only listens on loopback, so it can never be confused with the dev or
 * production database. If TEST_DATABASE_URL is already set — CI, a Neon branch —
 * nothing local starts and that database is used instead.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const RUN_DIR = process.env.E2E_DB_DIR ??
  (process.env.XDG_CACHE_HOME
    ? join(process.env.XDG_CACHE_HOME, "friendloop")
    : process.platform === "darwin"
      ? join(HOME, "Library", "Caches", "friendloop")
      : join(HOME, ".cache", "friendloop"));
const DATA_DIR = join(RUN_DIR, "data");
const LOG_FILE = join(RUN_DIR, "postgres.log");
const SOCKET_DIR = RUN_DIR;
const PORT = process.env.E2E_DB_PORT ?? "55432";
const USER = "postgres";
const DATABASE = "friendloop_test";
const URL_STRING = `postgresql://${USER}@127.0.0.1:${PORT}/${DATABASE}`;

function findBinDir() {
  const candidates = [
    process.env.PG_BIN,
    "/opt/homebrew/opt/postgresql@16/bin",
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@16/bin",
    "/usr/lib/postgresql/16/bin",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "initdb"))) return candidate;
  }

  try {
    const prefix = execFileSync("brew", ["--prefix", "postgresql@16"], { encoding: "utf8" }).trim();
    if (prefix && existsSync(join(prefix, "bin", "initdb"))) return join(prefix, "bin");
  } catch {
    // Not Homebrew — fall through to PATH.
  }

  return "";
}

const BIN = findBinDir();

/** True when `name` is runnable, either from the resolved dir or from PATH. */
function hasBinary(name) {
  if (BIN) return existsSync(join(BIN, name));
  return (process.env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .some((dir) => existsSync(join(dir, name)));
}

const bin = (name) => (BIN ? join(BIN, name) : name);

function run(name, args, options = {}) {
  return execFileSync(bin(name), args, { encoding: "utf8", ...options });
}

function tryRun(name, args) {
  try {
    return run(name, args, { stdio: "ignore" });
  } catch {
    return null;
  }
}

function isRunning() {
  if (!existsSync(DATA_DIR)) return false;
  try {
    run("pg_ctl", ["status", "-D", DATA_DIR], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function ensureCluster() {
  if (existsSync(DATA_DIR)) return;
  mkdirSync(SOCKET_DIR, { recursive: true });
  run("initdb", [
    "-D", DATA_DIR,
    "-U", USER,
    "--auth=trust",
    "--encoding=UTF8",
    "--locale=C",
  ], { stdio: "ignore" });
}

function start() {
  ensureCluster();
  if (!isRunning()) {
    run("pg_ctl", [
      "start",
      "-D", DATA_DIR,
      "-l", LOG_FILE,
      "-o", `-p ${PORT} -k ${SOCKET_DIR} -c listen_addresses=127.0.0.1`,
      "-w",
    ], { stdio: "ignore" });
  }
  tryRun("createdb", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, DATABASE]);
}

function stop() {
  if (!isRunning()) return;
  run("pg_ctl", ["stop", "-D", DATA_DIR, "-m", "fast"], { stdio: "ignore" });
}

function reset() {
  stop();
  rmSync(RUN_DIR, { recursive: true, force: true });
  start();
}

const command = process.argv[2] ?? "start";

if (!hasBinary("initdb")) {
  console.error(
    "Postgres not found. Install it with `brew install postgresql@16`, point PG_BIN at a bin directory, or set TEST_DATABASE_URL.",
  );
  process.exit(1);
}

switch (command) {
  case "start":
    start();
    // stdout is only the URL, so `export TEST_DATABASE_URL=$(npm run -s e2e:db)` works.
    console.log(URL_STRING);
    break;
  case "stop":
    stop();
    console.error("e2e database stopped");
    break;
  case "reset":
    reset();
    console.log(URL_STRING);
    break;
  case "status":
    console.log(isRunning() ? "running" : "stopped");
    break;
  case "run": {
    const [cmd, ...args] = process.argv.slice(3);
    if (!cmd) {
      console.error("Usage: e2e-db.mjs run <command> [args...]");
      process.exit(1);
    }
    const env = { ...process.env };
    if (!env.TEST_DATABASE_URL) {
      start();
      env.TEST_DATABASE_URL = URL_STRING;
      console.error(`e2e database ready at ${URL_STRING.replace(`/${DATABASE}`, "")}`);
    }
    const child = spawn(cmd, args, { stdio: "inherit", env });
    child.on("exit", (code, signal) => {
      process.exit(signal ? 1 : (code ?? 0));
    });
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}

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
 *
 * Runs can overlap (two worktrees, two agents). `run` gives each invocation its
 * own database in the shared cluster and its own free ports for the app and the
 * Resend stub, then drops the database when the command exits. Databases left by
 * a run that was killed are dropped the next time any run starts.
 *
 * The Next build output (`.next`) still belongs to the checkout, so overlapping
 * runs need separate checkouts: use a git worktree. A second run in the same
 * checkout stops early instead of rebuilding under the first one.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
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
/** Per-run databases are `friendloop_test_run_<pid>_<random>`; the pid finds orphans. */
const RUN_DATABASE_PREFIX = `${DATABASE}_run_`;
const databaseUrl = (name) => `postgresql://${USER}@127.0.0.1:${PORT}/${name}`;

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
  try {
    ensureCluster();
  } catch (error) {
    // Another run initialised the cluster at the same moment.
    if (!existsSync(join(DATA_DIR, "PG_VERSION"))) throw error;
  }
  if (!isRunning()) {
    try {
      run("pg_ctl", [
        "start",
        "-D", DATA_DIR,
        "-l", LOG_FILE,
        "-o", `-p ${PORT} -k ${SOCKET_DIR} -c listen_addresses=127.0.0.1`,
        "-w",
      ], { stdio: "ignore" });
    } catch (error) {
      // Another run started it first; that is fine as long as it is up now.
      if (!isRunning()) throw error;
    }
  }
  tryRun("createdb", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, DATABASE]);
}

function psql(sql) {
  return run("psql", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, "-d", "postgres", "-At", "-c", sql]);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** Drop per-run databases whose owning process is gone (a killed or crashed run). */
function dropOrphanedRunDatabases() {
  const names = psql(`select datname from pg_database where datname like '${RUN_DATABASE_PREFIX}%'`)
    .split("\n")
    .filter(Boolean);
  for (const name of names) {
    const pid = Number(name.slice(RUN_DATABASE_PREFIX.length).split("_")[0]);
    if (Number.isInteger(pid) && pid > 0 && !isAlive(pid)) dropRunDatabase(name);
  }
}

function createRunDatabase() {
  const name = `${RUN_DATABASE_PREFIX}${process.pid}_${randomBytes(3).toString("hex")}`;
  run("createdb", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, name]);
  return name;
}

function dropRunDatabase(name) {
  // FORCE ends the app server's lingering connections (Postgres 13+).
  tryRun("psql", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, "-d", "postgres", "-c", `drop database if exists "${name}" with (force)`]);
}

/** A port nothing is listening on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
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

// Only the commands that would actually stand up a cluster need the binaries.
// With TEST_DATABASE_URL supplied (CI's service container, or your own) `run`
// never touches Postgres, so demanding initdb there would fail on any runner
// that does not have a local install.
const needsCluster =
  command === "start" ||
  command === "reset" ||
  (command === "run" && !process.env.TEST_DATABASE_URL);

if (needsCluster && !hasBinary("initdb")) {
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
    // Only Playwright builds and serves the app; integration tests share nothing
    // but the cluster, which per-run databases already isolate.
    const usesBuild = [cmd, ...args].some((part) => part.includes("playwright"));
    const lockFile = usesBuild ? join(process.cwd(), ".e2e-run.lock") : null;
    if (lockFile && existsSync(lockFile)) {
      const holder = Number(readFileSync(lockFile, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && holder !== process.pid && isAlive(holder)) {
        console.error(
          `Another e2e run (pid ${holder}) is using this checkout's .next build. Wait for it, or run from a separate git worktree.`,
        );
        process.exit(1);
      }
    }
    if (lockFile) writeFileSync(lockFile, String(process.pid));

    const env = { ...process.env };
    let runDatabase = null;
    if (!env.TEST_DATABASE_URL) {
      start();
      dropOrphanedRunDatabases();
      runDatabase = createRunDatabase();
      env.TEST_DATABASE_URL = databaseUrl(runDatabase);
      console.error(`e2e database ready at ${env.TEST_DATABASE_URL}`);
    }
    // Explicit ports win, so a fixed setup (CI, a debugging session) still works.
    env.E2E_PORT ??= await freePort();
    env.E2E_FAKE_MAIL_PORT ??= await freePort();
    console.error(`e2e app port ${env.E2E_PORT}, mail stub port ${env.E2E_FAKE_MAIL_PORT}`);

    const cleanup = () => {
      if (runDatabase) dropRunDatabase(runDatabase);
      runDatabase = null;
      if (lockFile) rmSync(lockFile, { force: true });
    };
    const child = spawn(cmd, args, { stdio: "inherit", env });
    // Ctrl-C reaches the child through the process group; wait for it to exit
    // so the database is dropped only after the app server lets go of it.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => child.kill(signal));
    }
    child.on("exit", (code, signal) => {
      cleanup();
      process.exit(signal ? 1 : (code ?? 0));
    });
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}

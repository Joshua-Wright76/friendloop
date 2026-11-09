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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { constants as osConstants, cpus, homedir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { integrationDatabaseName, integrationTestFiles, integrationTestHash } from "../test/database.mjs";

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

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Serialise cluster init and start across concurrent runs. `mkdir` is atomic, so
 * only one run holds the directory at a time; a lock older than a minute
 * belongs to a run that died mid-start and is taken over.
 */
function withStartLock(fn) {
  mkdirSync(RUN_DIR, { recursive: true });
  const lock = join(RUN_DIR, "start.lock");
  const deadline = Date.now() + 120_000;
  while (true) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 60_000) rmSync(lock, { recursive: true, force: true });
      } catch {
        // Released between the check and the stat; just retry.
      }
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${lock}`);
      sleepSync(200);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

function ensureCluster() {
  if (existsSync(join(DATA_DIR, "PG_VERSION")) && existsSync(join(DATA_DIR, "postgresql.conf"))) return;
  // A directory without a finished cluster is left from an interrupted initdb.
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(SOCKET_DIR, { recursive: true });
  run("initdb", [
    "-D", DATA_DIR,
    "-U", USER,
    "--auth=trust",
    "--encoding=UTF8",
    "--locale=C",
  ], { stdio: "ignore" });
}

/** `pg_ctl status` is true once postmaster.pid exists; wait until it takes connections. */
function waitUntilReady() {
  const deadline = Date.now() + 15_000;
  while (true) {
    try {
      run("pg_isready", ["-h", "127.0.0.1", "-p", PORT, "-U", USER], { stdio: "ignore" });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      sleepSync(200);
    }
  }
}

function start() {
  withStartLock(() => {
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
  });
  waitUntilReady();
  tryRun("createdb", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, DATABASE]);
}

function psql(sql) {
  return run("psql", ["-h", "127.0.0.1", "-p", PORT, "-U", USER, "-d", "postgres", "-At", "-c", sql]);
}

function tryPsql(sql) {
  try {
    return psql(sql);
  } catch {
    return "";
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/**
 * Drop per-run databases left by a killed or crashed run: the owning pid is gone
 * and nothing is connected. The connection check covers a live run whose pid
 * this process cannot see (another pid namespace, a sandbox).
 */
function dropOrphanedRunDatabases() {
  const rows = psql(
    "select d.datname, count(a.pid) from pg_database d left join pg_stat_activity a on a.datname = d.datname " +
      `where d.datname like '${RUN_DATABASE_PREFIX}%' group by d.datname`,
  )
    .split("\n")
    .filter(Boolean);
  for (const row of rows) {
    const [name, connections] = row.split("|");
    if (Number(connections) > 0) continue;
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

/** External bases are borrowed: drop exactly this run's integration children, never the base. */
async function dropExternalIntegrationDatabases(baseUrl, files) {
  if (files.length === 0) return;
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const sql = postgres(adminUrl.toString(), { prepare: false, max: 1, onnotice: () => undefined });
  try {
    for (const file of files) {
      const name = integrationDatabaseName(baseUrl, file);
      const quoted = `"${name.replaceAll('"', '""')}"`;
      await sql.unsafe(`drop database if exists ${quoted} with (force)`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** `count` distinct free ports, held open together so none can repeat. */
async function freePorts(count) {
  const servers = await Promise.all(
    Array.from({ length: count }, () => new Promise((resolve, reject) => {
      const server = createServer();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => resolve(server));
    })),
  );
  const ports = servers.map((server) => String(server.address().port));
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  return ports;
}

/**
 * One Playwright run per checkout: they share `.next`. The lock is created with
 * `wx` so two runs starting together cannot both take it; a lock whose pid is
 * gone is stale and replaced.
 */
function takeRunLock(lockFile) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(lockFile, String(process.pid), { flag: "wx" });
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const holder = Number(readFileSync(lockFile, "utf8").trim());
      if (Number.isInteger(holder) && holder > 0 && isAlive(holder)) {
        console.error(
          `Another e2e run (pid ${holder}) is using this checkout's .next build. Wait for it, or run from a separate git worktree.`,
        );
        return false;
      }
      rmSync(lockFile, { force: true });
    }
  }
  return false;
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
    const env = { ...process.env };
    const usesBuild = [cmd, ...args].some((part) => part.includes("playwright"));
    const usesIntegration = args.includes("--test-global-setup=./test/global-setup.mjs");
    if (usesBuild && env.E2E_REUSE_SERVER === "1") {
      // A reusable server must keep pointing at the same database and ports. The
      // normal per-run database is dropped on exit, so it cannot survive with it.
      if (!env.TEST_DATABASE_URL) {
        console.error("E2E_REUSE_SERVER=1 requires TEST_DATABASE_URL for a persistent disposable database.");
        process.exit(1);
      }
      if (!env.E2E_PORT) {
        console.error("E2E_REUSE_SERVER=1 requires an explicit E2E_PORT (and normally E2E_FAKE_MAIL_PORT).");
        process.exit(1);
      }
    }
    const lockFile = usesBuild ? join(process.cwd(), ".e2e-run.lock") : null;
    if (lockFile && !takeRunLock(lockFile)) process.exit(1);

    const suppliedDatabase = env.TEST_DATABASE_URL ?? null;
    let runDatabase = null;
    let integrationFiles = [];
    let cleanupPromise = null;
    const cleanup = () => {
      if (cleanupPromise) return cleanupPromise;
      cleanupPromise = (async () => {
        try {
          if (runDatabase) {
            // Local behavior stays unchanged: drop this run's children and its owned base.
            const children = tryPsql(
              `select datname from pg_database where datname like '${runDatabase}\\_w%' ` +
                `or datname like '${runDatabase}\\_i\\_%'`,
            );
            for (const name of children.split("\n").filter(Boolean)) dropRunDatabase(name);
            dropRunDatabase(runDatabase);
          } else if (suppliedDatabase && usesIntegration) {
            await dropExternalIntegrationDatabases(suppliedDatabase, integrationFiles);
          }
        } finally {
          if (lockFile) rmSync(lockFile, { force: true });
        }
      })();
      return cleanupPromise;
    };
    const signalExitCode = (signal) => 128 + (osConstants.signals[signal] ?? 1);
    const cleanupAndExit = async (code) => {
      try {
        await cleanup();
      } catch (error) {
        console.error(`Database cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
      process.exit(code);
    };
    const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
    // Until the child exists, a signal means: clean up what was made and leave.
    const early = (signal) => {
      void cleanupAndExit(signalExitCode(signal));
    };
    for (const signal of SIGNALS) process.on(signal, early);

    try {
      if (!env.TEST_DATABASE_URL) {
        start();
        dropOrphanedRunDatabases();
        runDatabase = createRunDatabase();
        env.TEST_DATABASE_URL = databaseUrl(runDatabase);
        // Only this run's databases: the cluster is shared with other sessions' (see relaxDurability).
        env.E2E_RELAX_DB ??= "commit";
        console.error(`e2e database ready at ${env.TEST_DATABASE_URL}`);
      }
      // Explicit Playwright ports win; integration mail ports are allocated per file.
      // A Playwright run gets a server per worker. Each costs a browser and a Node
      // process, so a third of the cores leaves the machine breathing; CI uses
      // three app/browser workers on its four cores.
      if (usesBuild) env.E2E_WORKERS ??= String(env.CI ? 3 : Math.min(6, Math.max(1, Math.floor(cpus().length / 3))));
      const workers = Number(env.E2E_WORKERS ?? 1);
      if (usesIntegration) {
        // Only these children have the per-file databases created by global setup.
        env.TEST_INTEGRATION_ISOLATION = "1";
        integrationFiles = integrationTestFiles();
        const ports = await freePorts(integrationFiles.length);
        env.TEST_MAIL_PORTS = JSON.stringify(Object.fromEntries(
          integrationFiles.map((file, index) => [integrationTestHash(file), ports[index]]),
        ));
      }
      const [mailPort, ...appPorts] = await freePorts(workers + 1);
      if (!env.E2E_PORT) {
        env.E2E_PORT = appPorts[0];
        env.E2E_PORTS = appPorts.join(",");
      }
      if (!env.E2E_FAKE_MAIL_PORT) env.E2E_FAKE_MAIL_PORT = mailPort;
      console.error(`e2e workers ${workers}, app port ${env.E2E_PORTS ?? env.E2E_PORT}, mail stub port ${env.E2E_FAKE_MAIL_PORT}`);
    } catch (error) {
      try {
        await cleanup();
      } catch (cleanupError) {
        console.error(`Database cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
      }
      throw error;
    }

    const child = spawn(cmd, args, { stdio: "inherit", env });
    for (const signal of SIGNALS) {
      process.off(signal, early);
      process.on(signal, () => {
        // A terminal's Ctrl-C already reaches the child through the process
        // group; forwarding a second SIGINT would make Playwright force-quit.
        if (signal === "SIGINT" && process.stdin.isTTY) return;
        child.kill(signal);
      });
    }
    child.on("error", (error) => {
      console.error(error.message);
      void cleanupAndExit(1);
    });
    // Wait for the child and cleanup so no database outlives the command.
    child.on("exit", (code, signal) => {
      void cleanupAndExit(signal ? signalExitCode(signal) : (code ?? 0));
    });
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(1);
}

#!/usr/bin/env node
/**
 * Runs before `next build` on Vercel (see vercel.json), so a deploy brings its
 * own schema with it: production migrates neondb and the `dev` branch migrates
 * friendloop_dev. A failure fails the build, which leaves the running deployment
 * in place. Old code runs against the new schema until the build goes live, and
 * that is safe because `check:migrations` runs first and refuses destructive DDL
 * unless a migration opts out with `-- expand-contract: yes`.
 *
 * Reads and writes the same bookkeeping table as `drizzle-kit migrate`, which
 * still works by hand. This does not call it because it has no lock: two merges
 * close together would both apply the same migration, and one would fail.
 */
import { pathToFileURL } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

/** Any constant works, as long as every deploy uses the same one. */
const LOCK_ID = 7_260_411_903;

/**
 * PR previews never migrate: an unmerged migration must not reach a shared
 * database. The repo is public, so the owner check stops a fork's branch that
 * happens to be called `dev` from running its SQL.
 */
export function migrationTarget(env) {
  if (env.VERCEL_ENV === "production") return "production";
  if (
    env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "dev" &&
    env.VERCEL_GIT_REPO_OWNER?.toLowerCase() === "joshua-wright76"
  ) {
    return "dev";
  }
  return null;
}

/**
 * Migrations run in timestamp order, so one that merges after a newer one reached
 * this database (applied by hand, say) would otherwise be skipped forever while
 * the deploy looks green. That is the outage this script exists to prevent.
 */
function assertNoneSkipped(migrations, recorded, last) {
  const hashes = new Set(recorded.map((row) => row.hash));
  const skipped = migrations.filter(
    (migration) => last !== null && migration.folderMillis <= Number(last) && !hashes.has(migration.hash),
  );
  if (skipped.length > 0) {
    const whens = skipped.map((migration) => migration.folderMillis).join(", ");
    throw new Error(
      `journal entries with timestamps ${whens} are older than the latest applied migration but were never ` +
        "applied, or their .sql changed after being applied. Apply them by hand and record them, or regenerate " +
        "them with a newer timestamp.",
    );
  }
}

/**
 * One transaction, so a failure applies nothing. The lock is transaction-scoped
 * and the last-applied read happens after taking it: DATABASE_URL is Neon's
 * transaction-mode pooler, where a session lock would not hold, and a deploy that
 * waited for the lock must see what the other one just applied.
 *
 * Waiting behind another deploy is normal, so that wait gets longer than waiting
 * on a table: DDL queued on a busy table holds up every query behind it.
 */
export async function applyMigrations(sql, { folder = "drizzle", schema = "drizzle" } = {}) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const table = sql(schema);

  return sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5min'`;
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`set local lock_timeout = '60s'`;
    await tx`create schema if not exists ${table}`;
    await tx`create table if not exists ${table}.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )`;

    const recorded = await tx`select hash, created_at from ${table}.__drizzle_migrations`;
    const stamps = recorded.map((row) => Number(row.created_at));
    const last = stamps.length > 0 ? Math.max(...stamps) : null;
    assertNoneSkipped(migrations, recorded, last);

    const pending = migrations.filter((migration) => last === null || migration.folderMillis > last);
    for (const migration of pending) {
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`insert into ${table}.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})`;
    }
    return pending.length;
  });
}

async function main() {
  const { VERCEL_ENV, VERCEL_GIT_COMMIT_REF, VERCEL_GIT_REPO_OWNER, DATABASE_URL } = process.env;
  const target = migrationTarget(process.env);
  if (!target) {
    console.log(
      `deploy-migrate: skipping (VERCEL_ENV=${VERCEL_ENV}, ref=${VERCEL_GIT_COMMIT_REF}, owner=${VERCEL_GIT_REPO_OWNER})`,
    );
    return;
  }
  if (!DATABASE_URL) throw new Error(`DATABASE_URL is not set for ${target}`);

  const { host, pathname } = new URL(DATABASE_URL);
  const sql = postgres(DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const applied = await applyMigrations(sql);
    console.log(`deploy-migrate: ${applied} migration(s) applied to ${target} (${host}${pathname})`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Only these fields: a bad URL's error object carries the whole URL, password included.
    console.error("deploy-migrate: failed, nothing was applied:", error.code ?? "", error.message);
    process.exit(1);
  });
}

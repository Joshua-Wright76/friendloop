#!/usr/bin/env node
/**
 * Runs before `next build` on Vercel (see vercel.json), so a deploy brings its
 * own schema with it: production migrates neondb and the `dev` branch migrates
 * friendloop_dev. A failure fails the build, which leaves the running deployment
 * in place. Old code runs against the new schema until the build goes live, and
 * that is safe because `check:migrations` runs first and refuses destructive DDL.
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

/** PR previews never migrate: an unmerged migration must not reach a shared database. */
export function migrationTarget(env) {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview" && env.VERCEL_GIT_COMMIT_REF === "dev") return "dev";
  return null;
}

/**
 * One transaction, so a failure applies nothing. The lock is transaction-scoped
 * and the last-applied read happens after taking it: DATABASE_URL is Neon's
 * transaction-mode pooler, where a session lock would not hold, and a deploy that
 * waited for the lock must see what the other one just applied.
 */
export async function applyMigrations(sql, { folder = "drizzle", schema = "drizzle" } = {}) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const table = sql(schema);

  return sql.begin(async (tx) => {
    await tx`set local lock_timeout = '60s'`;
    await tx`select pg_advisory_xact_lock(${LOCK_ID})`;
    await tx`create schema if not exists ${table}`;
    await tx`create table if not exists ${table}.__drizzle_migrations (
      id serial primary key, hash text not null, created_at bigint
    )`;

    const [{ last }] = await tx`select max(created_at) as last from ${table}.__drizzle_migrations`;
    const pending = migrations.filter((migration) => last === null || migration.folderMillis > Number(last));

    for (const migration of pending) {
      for (const statement of migration.sql) await tx.unsafe(statement);
      await tx`insert into ${table}.__drizzle_migrations (hash, created_at)
        values (${migration.hash}, ${migration.folderMillis})`;
    }
    return pending.length;
  });
}

async function main() {
  const target = migrationTarget(process.env);
  if (!target) {
    console.log("deploy-migrate: not production or the dev branch, skipping");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error(`DATABASE_URL is not set for ${target}`);

  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, onnotice: () => {} });
  try {
    const applied = await applyMigrations(sql);
    console.log(`deploy-migrate: ${applied} migration(s) applied to ${target}`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("deploy-migrate: failed, nothing was applied:", error.message);
    process.exit(1);
  });
}

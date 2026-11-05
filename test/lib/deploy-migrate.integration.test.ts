import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";
import { applyMigrations, migrationTarget } from "../../scripts/deploy-migrate.mjs";

// Everything lives in its own schema, so this can't disturb the suite's tables.
const SCHEMA = "deploy_migrate_test";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 4, onnotice: () => {} });
const options = (folder: string) => ({ folder, schema: SCHEMA });

let root: string;

/** A migrations folder in the layout drizzle-kit writes. */
function folderWith(migrations: Array<{ tag: string; when: number; body: string }>): string {
  const folder = mkdtempSync(path.join(root, "m-"));
  mkdirSync(path.join(folder, "meta"));
  writeFileSync(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: migrations.map(({ tag, when }, idx) => ({ idx, version: "7", when, tag, breakpoints: true })),
    }),
  );
  for (const { tag, body } of migrations) writeFileSync(path.join(folder, `${tag}.sql`), body);
  return folder;
}

const first = { tag: "0000_first", when: 1000, body: `CREATE TABLE ${SCHEMA}.a (id int);` };
const second = { tag: "0001_second", when: 2000, body: `ALTER TABLE ${SCHEMA}.a ADD COLUMN b int;` };

async function recorded(): Promise<number[]> {
  const found = await sql<{ created_at: string }[]>`
    select created_at from ${sql(SCHEMA)}.__drizzle_migrations order by created_at`;
  return found.map((row) => Number(row.created_at));
}

before(() => {
  root = mkdtempSync(path.join(tmpdir(), "deploy-migrate-"));
});
beforeEach(async () => {
  await sql`drop schema if exists ${sql(SCHEMA)} cascade`;
});
after(async () => {
  await sql`drop schema if exists ${sql(SCHEMA)} cascade`;
  await sql.end();
  rmSync(root, { recursive: true, force: true });
});

test("only production and the dev branch migrate", () => {
  assert.equal(migrationTarget({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }), "production");
  assert.equal(migrationTarget({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "dev" }), "dev");
  assert.equal(migrationTarget({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "some-pr" }), null);
  assert.equal(migrationTarget({ VERCEL_ENV: "development", VERCEL_GIT_COMMIT_REF: "dev" }), null);
  assert.equal(migrationTarget({}), null);
});

test("applies what is new and nothing twice", async () => {
  await sql`create schema ${sql(SCHEMA)}`;
  assert.equal(await applyMigrations(sql, options(folderWith([first]))), 1);
  assert.equal(await applyMigrations(sql, options(folderWith([first, second]))), 1);
  assert.equal(await applyMigrations(sql, options(folderWith([first, second]))), 0);
  assert.deepEqual(await recorded(), [1000, 2000]);
});

test("a database ahead of the code is left alone, as when redeploying an older commit", async () => {
  await sql`create schema ${sql(SCHEMA)}`;
  await applyMigrations(sql, options(folderWith([first, second])));
  assert.equal(await applyMigrations(sql, options(folderWith([first]))), 0);
  assert.deepEqual(await recorded(), [1000, 2000]);
});

test("simultaneous deploys apply each migration once", async () => {
  await sql`create schema ${sql(SCHEMA)}`;
  const folder = folderWith([first, second]);
  const counts = await Promise.all([1, 2, 3].map(() => applyMigrations(sql, options(folder))));
  assert.deepEqual(counts.sort(), [0, 0, 2]);
  assert.deepEqual(await recorded(), [1000, 2000]);
});

test("a failing migration applies nothing, including the ones before it", async () => {
  await sql`create schema ${sql(SCHEMA)}`;
  const broken = { tag: "0001_broken", when: 2000, body: `ALTER TABLE ${SCHEMA}.missing ADD COLUMN b int;` };
  await assert.rejects(applyMigrations(sql, options(folderWith([first, broken]))), /missing/);
  const tables = await sql`select 1 from information_schema.tables where table_schema = ${SCHEMA} and table_name = 'a'`;
  assert.equal(tables.length, 0);
});

function runCheck(folder: string) {
  // check-migrations reads ./drizzle, so give it a directory where that is the fixture.
  const cwd = mkdtempSync(path.join(root, "cwd-"));
  writeFileSync(path.join(cwd, ".keep"), "");
  spawnSync("cp", ["-R", folder, path.join(cwd, "drizzle")]);
  return spawnSync(process.execPath, [path.resolve("scripts/check-migrations.mjs")], { cwd, encoding: "utf8" });
}

test("check:migrations accepts an ordered journal", () => {
  assert.equal(runCheck(folderWith([first, second])).status, 0);
});

test("check:migrations refuses a journal entry that would be silently skipped", () => {
  const result = runCheck(folderWith([first, { ...second, when: 500 }]));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0001_second is not newer than 0000_first/);
});

test("check:migrations refuses a .sql file the journal does not list", () => {
  const folder = folderWith([first]);
  writeFileSync(path.join(folder, "0001_orphan.sql"), "SELECT 1;");
  const result = runCheck(folder);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0001_orphan.sql is not in the journal/);
});

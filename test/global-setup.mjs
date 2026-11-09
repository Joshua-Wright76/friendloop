/**
 * One migrated template and one cheap copy of it per integration file.
 *
 * `node --test` starts a process per file. The runner-wide hook resets and
 * migrates the base database once, then clones it with limited concurrency;
 * test/env.mjs points each absolute integration-test child at its own copy.
 *
 * Named export, not `default`: Node loads the module either way, but only calls
 * `globalSetup`. A default export is silently ignored.
 */
import postgres from "postgres";
import { migrate, resetSchema, testDatabaseUrl } from "../e2e/support/db.ts";
import { integrationDatabaseName, integrationTestFiles } from "./database.mjs";

const CREATE_CONCURRENCY = 4;

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function createDatabaseCopies(baseUrl, files) {
  const adminUrl = new URL(baseUrl);
  adminUrl.pathname = "/postgres";
  const baseName = decodeURIComponent(new URL(baseUrl).pathname.slice(1));
  const sql = postgres(adminUrl.toString(), {
    prepare: false,
    max: CREATE_CONCURRENCY,
    onnotice: () => undefined,
  });
  let next = 0;

  async function createNext() {
    while (next < files.length) {
      const file = files[next++];
      const name = integrationDatabaseName(baseUrl, file);
      await sql.unsafe(`drop database if exists ${quoteIdentifier(name)} with (force)`);
      await sql.unsafe(`create database ${quoteIdentifier(name)} template ${quoteIdentifier(baseName)}`);
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(CREATE_CONCURRENCY, files.length) }, () => createNext()),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function globalSetup() {
  await resetSchema();
  await migrate();
  await createDatabaseCopies(testDatabaseUrl(), integrationTestFiles());
}

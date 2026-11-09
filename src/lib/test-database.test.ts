import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import {
  databaseUrlForTest,
  integrationDatabaseName,
  integrationDatabaseUrl,
  integrationTestFiles,
} from "../../test/database.mjs";

const BASE = "postgresql://postgres@127.0.0.1:55432/friendloop_test_run_42_abc";

test("only wrapper-managed absolute integration children select per-file databases", () => {
  const relativeSetupPath = "test/lib/auth.integration.test.ts";
  const absoluteChildPath = `${process.cwd()}/${relativeSetupPath}`;

  assert.equal(databaseUrlForTest(BASE, relativeSetupPath, true), BASE);
  assert.equal(databaseUrlForTest(BASE, `${process.cwd()}/src/lib/auth.test.ts`, true), BASE);
  assert.notEqual(databaseUrlForTest(BASE, absoluteChildPath, true), BASE);
});

test("standalone integration files keep the supplied base database", () => {
  const absoluteChildPath = `${process.cwd()}/test/lib/auth.integration.test.ts`;

  assert.equal(databaseUrlForTest(BASE, absoluteChildPath), BASE);
  assert.equal(databaseUrlForTest(BASE, absoluteChildPath, false), BASE);
});

test("integration database names are stable, file-specific, and safely bounded", () => {
  const auth = `${process.cwd()}/test/lib/auth.integration.test.ts`;
  const reply = `${process.cwd()}/test/lib/reply.integration.test.ts`;
  const name = integrationDatabaseName(BASE, auth);

  assert.equal(name, integrationDatabaseName(BASE, auth));
  assert.notEqual(name, integrationDatabaseName(BASE, reply));
  assert.match(name, /^friendloop_test_run_42_abc_i_[a-f0-9]{16}$/);
  assert.ok(name.length <= 63);
});

test("long UTF-8 base names retain distinct file hashes within Postgres's limit", () => {
  const longBase = `postgresql://postgres@127.0.0.1:55432/${"é".repeat(40)}`;
  const auth = `${process.cwd()}/test/lib/auth.integration.test.ts`;
  const reply = `${process.cwd()}/test/lib/reply.integration.test.ts`;
  const authName = integrationDatabaseName(longBase, auth);
  const replyName = integrationDatabaseName(longBase, reply);

  assert.ok(Buffer.byteLength(authName) <= 63);
  assert.notEqual(authName, replyName);
  assert.match(authName, /_i_[a-f0-9]{16}$/);
  assert.doesNotMatch(authName, /\uFFFD/);
});

test("literal percent sequences in database names survive URL mapping", () => {
  const file = `${process.cwd()}/test/lib/auth.integration.test.ts`;
  const base = "postgresql://postgres@127.0.0.1:55432/my%2520db";
  const name = integrationDatabaseName(base, file);
  const mapped = new URL(integrationDatabaseUrl(base, file));

  assert.match(mapped.pathname, /^\/my%2520db_i_/);
  assert.equal(decodeURIComponent(mapped.pathname.slice(1)), name);
});

test("integration enumeration recurses and ignores other test files", () => {
  const directory = mkdtempSync(join(tmpdir(), "friendloop-integration-files-"));
  try {
    mkdirSync(join(directory, "nested", "deeper"), { recursive: true });
    for (const file of [
      "root.integration.test.ts",
      "nested/child.integration.test.ts",
      "nested/deeper/leaf.integration.test.ts",
      "nested/ignored.test.ts",
    ]) {
      writeFileSync(join(directory, file), "");
    }

    const files = integrationTestFiles(directory)
      .map((file: string) => relative(directory, file).split(sep).join("/"));
    assert.deepEqual(files, [
      "nested/child.integration.test.ts",
      "nested/deeper/leaf.integration.test.ts",
      "root.integration.test.ts",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

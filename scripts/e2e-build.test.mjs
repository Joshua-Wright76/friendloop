import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sourceFingerprint, validateBuild, writeBuildMetadata } from "../e2e/support/build.ts";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "friendloop-e2e-build-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, ".next"));
  writeFileSync(join(cwd, ".next", "BUILD_ID"), "build-one\n");
  writeFileSync(join(cwd, ".next", "required-server-files.json"), "{}\n");
  return cwd;
}

test("source fingerprints include untracked source and ignored env changes", (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "friendloop-e2e-build-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "new.ts"), "export const value = 1;\n");
  const original = sourceFingerprint(cwd);
  assert.equal(original, sourceFingerprint(cwd));

  writeFileSync(join(cwd, "src", "new.ts"), "export const value = 2;\n");
  assert.notEqual(sourceFingerprint(cwd), original);
  const changedSource = sourceFingerprint(cwd);
  writeFileSync(join(cwd, ".env"), "NEXT_PUBLIC_SENTRY_DSN=changed\n");
  assert.notEqual(sourceFingerprint(cwd), changedSource);
});

test("a recorded build passes skipped-build validation", (t) => {
  const cwd = fixture(t);
  writeBuildMetadata(cwd, () => "source-one");
  assert.doesNotThrow(() => validateBuild(cwd, () => "source-one"));
});

test("skipped-build validation explains missing output and metadata", (t) => {
  const empty = mkdtempSync(join(tmpdir(), "friendloop-e2e-build-"));
  t.after(() => rmSync(empty, { recursive: true, force: true }));
  assert.throws(() => validateBuild(empty, () => "source-one"), /no complete Next production build/);

  const cwd = fixture(t);
  assert.throws(() => validateBuild(cwd, () => "source-one"), /source cannot be verified/);
});

test("skipped-build validation rejects stale source", (t) => {
  const cwd = fixture(t);
  writeBuildMetadata(cwd, () => "source-one");
  assert.throws(() => validateBuild(cwd, () => "source-two"), /build is stale/);
});

test("skipped-build validation rejects mixed or incomplete output", (t) => {
  const cwd = fixture(t);
  writeBuildMetadata(cwd, () => "source-one");
  writeFileSync(join(cwd, ".next", "BUILD_ID"), "another-build\n");
  assert.throws(() => validateBuild(cwd, () => "source-one"), /mixed or from an unsupported build/);

  writeBuildMetadata(cwd, () => "source-one");
  rmSync(join(cwd, ".next", "required-server-files.json"));
  assert.throws(() => validateBuild(cwd, () => "source-one"), /build is incomplete/);
});

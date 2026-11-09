import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { sourceFingerprint, validateBuild, writeBuildMetadata } from "../e2e/support/build.ts";

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "friendloop-e2e-build-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, ".next", "server", "app"), { recursive: true });
  mkdirSync(join(cwd, ".next", "static", "chunks"), { recursive: true });
  writeFileSync(join(cwd, ".next", "BUILD_ID"), "build-one\n");
  for (const file of [
    "required-server-files.json",
    "build-manifest.json",
    "server/app-paths-manifest.json",
    "prerender-manifest.json",
    "routes-manifest.json",
  ]) {
    writeFileSync(join(cwd, ".next", file), "{}\n");
  }
  writeFileSync(join(cwd, ".next", "server", "app", "page.js"), "// server runtime\n");
  writeFileSync(join(cwd, ".next", "static", "chunks", "main.js"), "// static runtime\n");
  return cwd;
}

function sourceFixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), "friendloop-e2e-build-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet"], { cwd });
  mkdirSync(join(cwd, "src"));
  writeFileSync(join(cwd, "src", "new.ts"), "export const value = 1;\n");
  return cwd;
}

test("source fingerprints include untracked source and ignored env changes", (t) => {
  const cwd = sourceFixture(t);
  const original = sourceFingerprint(cwd);
  assert.equal(original, sourceFingerprint(cwd));

  writeFileSync(join(cwd, "src", "new.ts"), "export const value = 2;\n");
  assert.notEqual(sourceFingerprint(cwd), original);
  const changedSource = sourceFingerprint(cwd);
  writeFileSync(join(cwd, ".env"), "NEXT_PUBLIC_SENTRY_DSN=changed\n");
  assert.notEqual(sourceFingerprint(cwd), changedSource);
});

test("source fingerprints trust only the current repository when Git detects a different owner", (t) => {
  const cwd = sourceFixture(t);
  const previous = process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
  process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
  try {
    assert.match(sourceFingerprint(cwd), /^[a-f0-9]{64}$/);
  } finally {
    if (previous === undefined) delete process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER;
    else process.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = previous;
  }
});

test("source fingerprints hash unstaged deletion of tracked source", (t) => {
  const cwd = sourceFixture(t);
  const tracked = join(cwd, "src", "tracked.ts");
  writeFileSync(tracked, "export const tracked = true;\n");
  execFileSync("git", ["add", "--", "src/tracked.ts"], { cwd });
  const original = sourceFingerprint(cwd);

  rmSync(tracked);
  const deleted = sourceFingerprint(cwd);
  assert.notEqual(deleted, original);
  assert.equal(sourceFingerprint(cwd), deleted);

  writeFileSync(tracked, "export const tracked = true;\n");
  assert.equal(sourceFingerprint(cwd), original);
});

test("source fingerprints canonically hash supplied build environment", (t) => {
  const cwd = sourceFixture(t);
  const original = {
    NEXT_PUBLIC_SENTRY_DSN: "public-one",
    VERCEL_ENV: "preview",
    SENTRY_AUTH_TOKEN: "secret-one",
  };
  const originalHash = sourceFingerprint(cwd, original);
  assert.equal(originalHash, sourceFingerprint(cwd, {
    SENTRY_AUTH_TOKEN: "secret-one",
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SENTRY_DSN: "public-one",
  }));
  assert.notEqual(sourceFingerprint(cwd, { ...original, NEXT_PUBLIC_SENTRY_DSN: "public-two" }), originalHash);
  assert.notEqual(sourceFingerprint(cwd, { ...original, SENTRY_AUTH_TOKEN: "secret-two" }), originalHash);
  assert.notEqual(sourceFingerprint(cwd, { ...original, ALLOWED_DEV_ORIGINS: "preview.local" }), originalHash);
});

test("a recorded build passes validation with a sorted cache/dev-free inventory", (t) => {
  const cwd = fixture(t);
  mkdirSync(join(cwd, ".next", "cache"));
  mkdirSync(join(cwd, ".next", "dev"));
  writeFileSync(join(cwd, ".next", "cache", "compiler"), "excluded");
  writeFileSync(join(cwd, ".next", "dev", "state"), "excluded");
  writeBuildMetadata(cwd, () => "source-one");
  assert.doesNotThrow(() => validateBuild(cwd, () => "source-one"));
  const marker = JSON.parse(readFileSync(join(cwd, ".next", "e2e-build.json"), "utf8"));
  assert.deepEqual(marker.files, [...marker.files].sort());
  assert.equal(marker.files.some((file) => file.startsWith("cache/") || file.startsWith("dev/")), false);
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

test("skipped-build validation rejects mixed, incomplete, or invalid output", (t) => {
  const cwd = fixture(t);
  writeBuildMetadata(cwd, () => "source-one");
  writeFileSync(join(cwd, ".next", "BUILD_ID"), "another-build\n");
  assert.throws(() => validateBuild(cwd, () => "source-one"), /mixed or from an unsupported build/);

  writeBuildMetadata(cwd, () => "source-one");
  rmSync(join(cwd, ".next", "required-server-files.json"));
  assert.throws(() => validateBuild(cwd, () => "source-one"), /build is incomplete/);

  writeFileSync(join(cwd, ".next", "required-server-files.json"), "not json\n");
  assert.throws(() => validateBuild(cwd, () => "source-one"), /core manifest required-server-files.json is missing or invalid/);
});

test("skipped-build validation rejects deleted server and static runtime files", (t) => {
  for (const file of ["server/app/page.js", "static/chunks/main.js"]) {
    const cwd = fixture(t);
    writeBuildMetadata(cwd, () => "source-one");
    rmSync(join(cwd, ".next", file));
    assert.throws(
      () => validateBuild(cwd, () => "source-one"),
      (error) => error.message.includes(`runtime file ${file} is missing`),
    );
  }
});

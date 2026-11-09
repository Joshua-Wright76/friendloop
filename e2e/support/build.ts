import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MARKER = "e2e-build.json";
const MARKER_VERSION = 1;
const BUILD_INPUTS = [
  "src",
  "public",
  "drizzle",
  "next.config.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
];
const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
];

type Fingerprint = (cwd: string) => string;

/** Hash build inputs, including untracked source and ignored local env files. */
export function sourceFingerprint(cwd = process.cwd()): string {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...BUILD_INPUTS],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const files = new Set(listed.split("\0").filter(Boolean));
  for (const file of ENV_FILES) {
    if (existsSync(join(cwd, file))) files.add(file);
  }

  const hash = createHash("sha256");
  for (const file of [...files].sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(cwd, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function buildId(cwd: string): string | null {
  const path = join(cwd, ".next", "BUILD_ID");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

/** Record only after next build has completed successfully. */
export function writeBuildMetadata(cwd = process.cwd(), fingerprint: Fingerprint = sourceFingerprint): void {
  const id = buildId(cwd);
  if (!id) throw new Error(`Cannot record e2e build: ${join(cwd, ".next", "BUILD_ID")} is missing.`);
  const path = join(cwd, ".next", MARKER);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    version: MARKER_VERSION,
    buildId: id,
    source: fingerprint(cwd),
  })}\n`);
}

/** Fail before Playwright starts servers against absent or stale output. */
export function validateBuild(cwd = process.cwd(), fingerprint: Fingerprint = sourceFingerprint): void {
  const id = buildId(cwd);
  const markerPath = join(cwd, ".next", MARKER);
  const rebuild = "Run `npm run e2e` without E2E_SKIP_BUILD to create a fresh production build.";
  if (!id) throw new Error(`E2E_SKIP_BUILD=1: no complete Next production build was found (.next/BUILD_ID is missing). ${rebuild}`);
  if (!existsSync(join(cwd, ".next", "required-server-files.json"))) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production build is incomplete (.next/required-server-files.json is missing). ${rebuild}`);
  }
  if (!existsSync(markerPath)) {
    throw new Error(`E2E_SKIP_BUILD=1: ${markerPath} is missing, so the build's source cannot be verified. ${rebuild}`);
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error(`E2E_SKIP_BUILD=1: ${markerPath} is invalid. ${rebuild}`);
  }
  if (marker.version !== MARKER_VERSION || marker.buildId !== id || typeof marker.source !== "string") {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production output is mixed or from an unsupported build. ${rebuild}`);
  }
  if (marker.source !== fingerprint(cwd)) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production build is stale because source, configuration, dependencies, or local env files changed. ${rebuild}`);
  }
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const MARKER = "e2e-build.json";
const MARKER_VERSION = 2;
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
const BUILD_ENV_KEYS = new Set([
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "ALLOWED_DEV_ORIGINS",
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT",
]);
const CORE_MANIFESTS = [
  "required-server-files.json",
  "build-manifest.json",
  "server/app-paths-manifest.json",
  "prerender-manifest.json",
  "routes-manifest.json",
];

type BuildEnv = NodeJS.ProcessEnv;
type Fingerprint = (cwd: string, env: BuildEnv) => string;

/** A canonical digest only: raw values, including secrets, never enter metadata. */
function buildEnvironmentFingerprint(env: BuildEnv): string {
  const keys = Object.keys(env)
    .filter((key) => key.startsWith("NEXT_PUBLIC_") || BUILD_ENV_KEYS.has(key))
    .sort();
  const hash = createHash("sha256");
  for (const key of keys) {
    hash.update(key);
    hash.update("\0");
    hash.update(env[key] ?? "");
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Hash build inputs, including untracked source, local env files, and shell env. */
export function sourceFingerprint(cwd = process.cwd(), env: BuildEnv = process.env): string {
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
    const path = join(cwd, file);
    // A tracked file can be deleted without being unstaged. Keep it in the
    // fingerprint so validation reports staleness instead of crashing.
    hash.update(existsSync(path) ? readFileSync(path) : "friendloop:deleted");
    hash.update("\0");
  }
  hash.update("build-environment\0");
  hash.update(buildEnvironmentFingerprint(env));
  return hash.digest("hex");
}

function buildId(cwd: string): string | null {
  const path = join(cwd, ".next", "BUILD_ID");
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").trim() || null;
}

/** Every runtime file expected after the build, relative to .next and portable. */
function runtimeInventory(cwd: string): string[] {
  const files: string[] = [];
  function visit(directory: string, prefix = ""): void {
    for (const entry of readdirSync(join(cwd, ".next", directory), { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!prefix && (entry.name === "cache" || entry.name === "dev" || entry.name === MARKER)) continue;
      if (entry.isDirectory()) visit(relative, relative);
      else files.push(relative);
    }
  }
  visit("");
  return files.sort();
}

/** Record only after next build has completed successfully. */
export function writeBuildMetadata(
  cwd = process.cwd(),
  fingerprint: Fingerprint = sourceFingerprint,
  env: BuildEnv = process.env,
): void {
  const id = buildId(cwd);
  if (!id) throw new Error(`Cannot record e2e build: ${join(cwd, ".next", "BUILD_ID")} is missing.`);
  const path = join(cwd, ".next", MARKER);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({
    version: MARKER_VERSION,
    buildId: id,
    source: fingerprint(cwd, env),
    files: runtimeInventory(cwd),
  })}\n`);
}

function validateCoreManifests(cwd: string, rebuild: string): void {
  for (const file of CORE_MANIFESTS) {
    try {
      JSON.parse(readFileSync(join(cwd, ".next", file), "utf8"));
    } catch {
      throw new Error(`E2E_SKIP_BUILD=1: the Next production build is incomplete: core manifest ${file} is missing or invalid. ${rebuild}`);
    }
  }
}

/** Fail before Playwright starts servers against absent, damaged, or stale output. */
export function validateBuild(
  cwd = process.cwd(),
  fingerprint: Fingerprint = sourceFingerprint,
  env: BuildEnv = process.env,
): void {
  const id = buildId(cwd);
  const markerPath = join(cwd, ".next", MARKER);
  const rebuild = "Run `npm run e2e` without E2E_SKIP_BUILD to create a fresh production build.";
  if (!id) throw new Error(`E2E_SKIP_BUILD=1: no complete Next production build was found (.next/BUILD_ID is missing). ${rebuild}`);
  if (!existsSync(markerPath)) {
    throw new Error(`E2E_SKIP_BUILD=1: ${markerPath} is missing, so the build's source cannot be verified. ${rebuild}`);
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error(`E2E_SKIP_BUILD=1: ${markerPath} is invalid. ${rebuild}`);
  }
  if (
    marker.version !== MARKER_VERSION ||
    marker.buildId !== id ||
    typeof marker.source !== "string" ||
    !Array.isArray(marker.files) ||
    !marker.files.every((file: unknown) => typeof file === "string")
  ) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production output is mixed or from an unsupported build. ${rebuild}`);
  }
  if (marker.source !== fingerprint(cwd, env)) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production build is stale because source, configuration, dependencies, or build environment changed. ${rebuild}`);
  }

  validateCoreManifests(cwd, rebuild);
  const files: string[] = marker.files;
  if (!files.some((file) => file.startsWith("server/") && file.endsWith(".js"))) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production build is incomplete: no server runtime output was recorded. ${rebuild}`);
  }
  if (!files.some((file) => file.startsWith("static/"))) {
    throw new Error(`E2E_SKIP_BUILD=1: the Next production build is incomplete: no static runtime output was recorded. ${rebuild}`);
  }
  for (const file of files) {
    if (!existsSync(join(cwd, ".next", file))) {
      throw new Error(`E2E_SKIP_BUILD=1: the Next production build is incomplete: runtime file ${file} is missing. ${rebuild}`);
    }
  }
}

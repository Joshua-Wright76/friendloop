import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const INTEGRATION_SUFFIX = ".integration.test.ts";
const INTEGRATION_DIRECTORY = "test/lib";

/** The same repo-relative filename produces the same key in every checkout. */
export function integrationTestHash(file) {
  const filename = relative(process.cwd(), resolve(file)).split(sep).join("/");
  return createHash("sha256").update(filename).digest("hex").slice(0, 16);
}

export function integrationDatabaseName(baseUrl, file) {
  const hash = integrationTestHash(file);
  const base = new URL(baseUrl);
  const baseName = decodeURIComponent(base.pathname.slice(1));
  // Postgres identifiers are limited to 63 UTF-8 bytes. Preserve the entire
  // file hash so even a long base name cannot make two files share a database.
  const bytes = Buffer.from(baseName);
  let end = Math.min(bytes.length, 44);
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return `${bytes.subarray(0, end).toString()}_i_${hash}`;
}

export function integrationDatabaseUrl(baseUrl, file) {
  const url = new URL(baseUrl);
  url.pathname = `/${encodeURIComponent(integrationDatabaseName(baseUrl, file))}`;
  return url.toString();
}

export function isIntegrationTestFile(file) {
  return file?.endsWith(INTEGRATION_SUFFIX) ?? false;
}

/** Global setup has a relative argv[1]; only absolute paths belong to test children. */
export function databaseUrlForTest(baseUrl, file) {
  if (!file || !isAbsolute(file) || !isIntegrationTestFile(file)) return baseUrl;
  return integrationDatabaseUrl(baseUrl, file);
}

/** Must match the integration glob in package.json. */
export function integrationTestFiles() {
  return readdirSync(INTEGRATION_DIRECTORY, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(INTEGRATION_SUFFIX))
    .map((entry) => `${INTEGRATION_DIRECTORY}/${entry.name}`)
    .sort();
}

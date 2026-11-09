/**
 * Defaults for the database-backed unit tests, applied before any test module
 * imports the app.
 *
 * The integration run is expected to be started through `scripts/e2e-db.mjs`,
 * which supplies TEST_DATABASE_URL (a throwaway Postgres) the same way the
 * Playwright suite gets one. The wrapper marks integration runs explicitly so
 * each absolute test child gets the database global setup cloned for its file.
 * Standalone files and pure units keep the base URL; global setup has a relative
 * argv[1] and must also keep using the base template.
 */
import { databaseUrlForTest, integrationTestHash, isIntegrationTestFile } from "./database.mjs";
import { isAbsolute } from "node:path";

const baseDatabaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (baseDatabaseUrl) {
  const databaseUrl = databaseUrlForTest(
    baseDatabaseUrl,
    process.argv[1],
    process.env.TEST_INTEGRATION_ISOLATION === "1",
  );
  process.env.DATABASE_URL = databaseUrl;
  process.env.TEST_DATABASE_URL = databaseUrl;
}

// Mail-backed integration files also need separate servers: otherwise one
// file's teardown or forced-failure control request can interrupt another's.
const testFile = process.argv[1];
if (process.env.TEST_INTEGRATION_ISOLATION === "1" && process.env.TEST_MAIL_PORTS && testFile && isAbsolute(testFile) && isIntegrationTestFile(testFile)) {
  const ports = JSON.parse(process.env.TEST_MAIL_PORTS);
  const port = ports[integrationTestHash(testFile)];
  if (port) process.env.E2E_FAKE_MAIL_PORT = String(port);
}

process.env.E2E ??= "1";
process.env.EMAIL_TRANSPORT ??= "outbox";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3100";
process.env.CRON_SECRET ??= "e2e-cron-secret";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Integration tests need a database. Run them with `npm run test:integration` (starts a throwaway Postgres) or set TEST_DATABASE_URL.",
  );
}

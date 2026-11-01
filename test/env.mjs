/**
 * Defaults for the database-backed unit tests, applied before any test module
 * imports the app.
 *
 * The integration run is expected to be started through `scripts/e2e-db.mjs`,
 * which supplies TEST_DATABASE_URL (a throwaway Postgres) the same way the
 * Playwright suite gets one.
 */
process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
process.env.E2E ??= "1";
process.env.EMAIL_TRANSPORT ??= "outbox";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:3100";
process.env.CRON_SECRET ??= "e2e-cron-secret";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Integration tests need a database. Run them with `npm run test:integration` (starts a throwaway Postgres) or set TEST_DATABASE_URL.",
  );
}

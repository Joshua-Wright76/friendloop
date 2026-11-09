import { relaxDurability, resetSchema, migrate, prepareWorkerDatabases } from "./support/db";
import { startFakeResend } from "./support/fake-resend";
import { WORKERS } from "./support/parallel";

/**
 * A disposable database, rebuilt from the real migrations, and the Resend stub
 * every provider-path test talks to. Playwright keeps this process alive for the
 * whole run, so the stub stays up until `globalTeardown` closes it.
 */
export default async function globalSetup() {
  // Probes against a deployed URL (`E2E_BASE_URL`) are read-only: there is no
  // database to rebuild and no mail stub to start, and playwright.config.ts
  // starts no webServer for them.
  if (process.env.E2E_BASE_URL) return;

  await startFakeResend();
  await resetSchema();
  await migrate();
  await prepareWorkerDatabases(WORKERS);
  if (process.env.E2E_RELAX_DB) await relaxDurability(process.env.E2E_RELAX_DB, WORKERS);
}

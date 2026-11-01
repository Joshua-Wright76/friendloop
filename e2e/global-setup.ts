import { resetSchema, migrate } from "./support/db";
import { startFakeResend } from "./support/fake-resend";

/**
 * A disposable database, rebuilt from the real migrations, and the Resend stub
 * every provider-path test talks to. Playwright keeps this process alive for the
 * whole run, so the stub stays up until `globalTeardown` closes it.
 */
export default async function globalSetup() {
  await startFakeResend();
  await resetSchema();
  await migrate();
}

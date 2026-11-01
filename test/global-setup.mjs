/**
 * One disposable schema for the whole integration run.
 *
 * `node --test` starts a process per file, so doing this per file would migrate
 * the same database a dozen times; the runner-wide hook does it once, from the
 * real migrations, exactly like the Playwright global setup.
 */
import { migrate, resetSchema } from "../e2e/support/db.ts";

export default async function globalSetup() {
  await resetSchema();
  await migrate();
}

/**
 * One disposable schema for the whole integration run.
 *
 * `node --test` starts a process per file, so doing this per file would migrate
 * the same database a dozen times; the runner-wide hook does it once, from the
 * real migrations, exactly like the Playwright global setup.
 *
 * Named export, not `default`: Node loads the module either way, but only calls
 * `globalSetup`. A default export is silently ignored — which is how this file
 * first shipped, and why the suite only ever passed on a database Playwright had
 * happened to build.
 */
import { migrate, resetSchema } from "../e2e/support/db.ts";

export async function globalSetup() {
  await resetSchema();
  await migrate();
}

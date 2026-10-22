import { migrate, resetSchema } from "./support/db";

/** A disposable database, rebuilt from the real migrations before any worker runs. */
export default async function globalSetup() {
  await resetSchema();
  await migrate();
}

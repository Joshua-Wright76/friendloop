/**
 * Shared harness for the database-backed unit tests.
 *
 * The Playwright suite already owns a disposable Postgres and a set of fixtures;
 * these tests reuse both rather than inventing a second way to build a loop. A
 * test that needs an issue, a member, or an outbox row asks the same helpers the
 * browser suite asks.
 */
import { eq } from "drizzle-orm";
import { migrate, resetSchema } from "../../e2e/support/db.ts";
import { db } from "@/db";
import { groups } from "@/db/schema";

export { resetDatabase, rows, latestOutbox, outboxCount, linkFrom } from "../../e2e/support/db.ts";
export { seedLoop, seedOpenIssue, seedDeliveredIssue, seedReplies, addMember } from "../../e2e/support/seed.ts";
export { E2E_NOW, AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DELIVERY_DAY, DAY, HOUR } from "../../e2e/support/clock.ts";

let schemaReady: Promise<void> | null = null;

/**
 * Build the schema once per test file, from the migrations, exactly as the e2e
 * global setup does. Idempotent because several test files share one database.
 */
export function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await resetSchema();
    await migrate();
  })();
  return schemaReady;
}

/** The loop row in the shape the library takes, not a raw snake_case record. */
export async function groupOf(groupId: string): Promise<typeof groups.$inferSelect> {
  const [group] = await db.select().from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!group) throw new Error(`No group ${groupId}`);
  return group;
}

/** NODE_ENV and friends are read-only in @types/node; tests still need to move them. */
export function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else Object.assign(process.env, { [name]: value });
}

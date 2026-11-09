/**
 * Shared harness for the database-backed unit tests.
 *
 * The Playwright suite already owns a disposable Postgres and a set of fixtures;
 * these tests reuse both rather than inventing a second way to build a loop. A
 * test that needs an issue, a member, or an outbox row asks the same helpers the
 * browser suite asks.
 */
import { before, beforeEach } from "node:test";
import { eq } from "drizzle-orm";
import { migrate, resetDatabase, resetSchema, rows } from "../../e2e/support/db.ts";
import { db } from "@/db";
import { groups } from "@/db/schema";

export { resetDatabase, rows, latestOutbox, outboxCount, linkFrom } from "../../e2e/support/db.ts";
export { seedLoop, seedOpenIssue, seedDeliveredIssue, seedReplies, addMember } from "../../e2e/support/seed.ts";
export { E2E_NOW, AFTER_FIRST_SLOT, BEFORE_FIRST_SLOT, DELIVERY_DAY, DAY, HOUR } from "../../e2e/support/clock.ts";

/**
 * Every database-backed test file starts here.
 *
 * `npm run test:integration` clones a migrated schema for each file, but a
 * single file is also runnable on its own (`node --test test/lib/auth…`), and a
 * guard that only works when a runner-wide hook happened to fire is not a guard.
 * So: empty every table between tests, and build the schema here if the database
 * does not have one.
 */
export function setupDatabase(): void {
  before(async () => {
    if (await schemaExists()) return;
    await resetSchema();
    await migrate();
  });
  beforeEach(resetDatabase);
}

async function schemaExists(): Promise<boolean> {
  const [row] = await rows<{ present: boolean }>("select to_regclass('public.groups') is not null as present");
  return row.present;
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

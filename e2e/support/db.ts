import postgres from "postgres";

/**
 * Tests own their database. `TEST_DATABASE_URL` must point at a throwaway Postgres
 * (a Neon branch, or a local container) — never at development data.
 */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Set TEST_DATABASE_URL to a throwaway Postgres (Neon branch or `docker run postgres`) before running e2e.",
    );
  }
  return url;
}

function client() {
  return postgres(testDatabaseUrl(), { prepare: false, max: 2 });
}

const TABLES = [
  "email_events",
  "outbox",
  "reactions",
  "comments",
  "replies",
  "issue_questions",
  "issues",
  "questions",
  "memberships",
  "groups",
  "sessions",
  "magic_links",
  "users",
];

/** Empty every table between tests so a worker can never see another test's loop. */
export async function resetDatabase(): Promise<void> {
  const sql = client();
  await sql.unsafe(`truncate table ${TABLES.join(", ")} restart identity cascade`);
  await sql.end({ timeout: 5 });
}

/** Throw away the whole schema — the test database is disposable by contract. */
export async function resetSchema(): Promise<void> {
  const sql = client();
  await sql.unsafe("set client_min_messages = warning; drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await sql.end({ timeout: 5 });
}

/** Apply the drizzle migrations to a fresh database. */
export async function migrate(): Promise<void> {
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate: runMigrations } = await import("drizzle-orm/postgres-js/migrator");
  const client = postgres(testDatabaseUrl(), { prepare: false, max: 1 });
  const database = drizzle(client);
  await runMigrations(database, { migrationsFolder: "drizzle" });
  await client.end({ timeout: 5 });
}

/** Escape hatch for assertions that the UI does not expose. */
export async function rows<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const sql = client();
  const result = await sql.unsafe(text, params as never[]);
  await sql.end({ timeout: 5 });
  return result as unknown as T[];
}

export type OutboxRow = {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  dedupe_key: string;
  status: string;
};

/** Read the newest email the app would have sent — no mail server involved. */
export async function latestOutbox(prefix: string): Promise<OutboxRow | null> {
  const sql = client();
  const rows = await sql<OutboxRow[]>`
    select id, "to", subject, html, text, dedupe_key, status
    from outbox
    where dedupe_key like ${`${prefix}%`}
    order by created_at desc
    limit 1
  `;
  await sql.end({ timeout: 5 });
  return rows[0] ?? null;
}

/** The newest email to one recipient — unambiguous when a test sends several. */
export async function latestOutboxFor(to: string): Promise<OutboxRow | null> {
  const sql = client();
  const rows = await sql<OutboxRow[]>`
    select id, "to", subject, html, text, dedupe_key, status
    from outbox
    where "to" = ${to}
    order by created_at desc
    limit 1
  `;
  await sql.end({ timeout: 5 });
  return rows[0] ?? null;
}

export async function outboxCount(prefix: string): Promise<number> {
  const sql = client();
  const rows = await sql<{ count: number }[]>`
    select count(*)::int as count from outbox where dedupe_key like ${`${prefix}%`}
  `;
  await sql.end({ timeout: 5 });
  return rows[0]?.count ?? 0;
}

/** Pull the first URL out of an email body, the way a person would click it. */
export function linkFrom(html: string, path: string): string {
  const pattern = new RegExp(`https?://[^"'\\s>]+${path}[^"'\\s<]*`);
  const match = html.match(pattern);
  if (!match) throw new Error(`No ${path} link in email body`);
  return match[0].replace(/&amp;/g, "&");
}

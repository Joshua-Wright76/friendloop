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
  "rate_limits",
  "heartbeats",
  "feedback",
  "email_events",
  "email_suppressions",
  "outbox",
  "section_media",
  "section_replies",
  "reactions",
  "comments",
  "replies",
  "music_links",
  "issue_sections",
  "events",
  "question_suggestions",
  "issue_questions",
  "issues",
  "sections",
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

/**
 * How long to wait for an email that a click just caused to be written.
 * Long enough for a cold CI runner, short enough that a genuinely missing
 * email still fails quickly.
 */
const OUTBOX_WAIT_MS = 5_000;
const OUTBOX_POLL_MS = 100;

/**
 * Wait for the row a click is supposed to produce.
 *
 * A single query races the write: `page.click()` resolves when the click
 * dispatches, not when the server action has committed the outbox row. That
 * race is intermittent and machine-dependent, which is exactly how it slipped
 * into CI as `Cannot read properties of null (reading 'html')` on A3.
 * Polling once here means no call site has to remember to wait.
 *
 * Throws rather than returning null: every caller wants the row, and a null
 * turned a clear failure into an opaque TypeError. To assert an email was
 * *not* sent, query with `rows()` instead.
 */
async function waitForOutbox(
  label: string,
  query: () => Promise<OutboxRow | undefined>,
): Promise<OutboxRow> {
  const deadline = Date.now() + OUTBOX_WAIT_MS;
  while (true) {
    const found = await query();
    if (found) return found;
    if (Date.now() >= deadline) {
      throw new Error(`No outbox row ${label} appeared within ${OUTBOX_WAIT_MS}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, OUTBOX_POLL_MS));
  }
}

/** Read the newest email the app would have sent — no mail server involved. */
export async function latestOutbox(prefix: string): Promise<OutboxRow> {
  const sql = client();
  try {
    return await waitForOutbox(`with dedupe_key like "${prefix}%"`, async () => {
      const found = await sql<OutboxRow[]>`
        select id, "to", subject, html, text, dedupe_key, status
        from outbox
        where dedupe_key like ${`${prefix}%`}
        order by created_at desc
        limit 1
      `;
      return found[0];
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** The newest email to one recipient — unambiguous when a test sends several. */
export async function latestOutboxFor(to: string): Promise<OutboxRow> {
  const sql = client();
  try {
    return await waitForOutbox(`addressed to "${to}"`, async () => {
      const found = await sql<OutboxRow[]>`
        select id, "to", subject, html, text, dedupe_key, status
        from outbox
        where "to" = ${to}
        order by created_at desc
        limit 1
      `;
      return found[0];
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
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

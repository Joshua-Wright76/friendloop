import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Lazily connected so importing this module (build-time analysis, unit tests) never
 * requires DATABASE_URL; the first real query does.
 *
 * postgres.js over the standard wire protocol, so the same code talks to a local
 * container in tests and to Neon's pooled endpoint in production. `prepare: false`
 * keeps it compatible with transaction-mode poolers.
 */
let instance: PostgresJsDatabase<typeof schema> | null = null;

function create(): PostgresJsDatabase<typeof schema> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. See .env.example");
  }
  const client = postgres(process.env.DATABASE_URL, { prepare: false, max: 5 });
  return drizzle(client, { schema });
}

export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, property) {
      instance ??= create();
      const value = Reflect.get(instance as object, property);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  },
);

export { schema };

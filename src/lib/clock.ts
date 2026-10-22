import { headers } from "next/headers";
import { connection } from "next/server";

/**
 * The single impure clock read in request-handling code.
 *
 * Pure logic (scheduling, delivery, sweeping) takes an explicit `at: Date`
 * instead of calling this, so it stays deterministic and testable. With
 * `E2E=1` a test can jump the app forward with an `x-e2e-now` header.
 */
export async function getNow(): Promise<Date> {
  // Reading the clock is request-time work: tell Next so a prerender stops here
  // instead of baking a timestamp into a static shell.
  try {
    await connection();
  } catch {
    // Outside a request (scripts, tests) there is nothing to mark.
  }

  if (process.env.E2E === "1") {
    try {
      const requestHeaders = await headers();
      const override = requestHeaders.get("x-e2e-now");
      if (override) {
        const parsed = new Date(override);
        if (!Number.isNaN(parsed.getTime())) return parsed;
      }
    } catch {
      // Outside a request scope (scripts, cron in tests) — fall through.
    }
  }
  return new Date();
}

/** Escape hatch for code that runs without a request (seed scripts, migrations). */
export function nowFromEnv(): Date {
  const override = process.env.E2E_NOW;
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

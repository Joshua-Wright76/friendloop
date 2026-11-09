#!/usr/bin/env node
/**
 * Prepare the disposable CI database and run one production build for every
 * Playwright shard. `mark` records a successful build started by Playwright's
 * first web server; `validate` checks output reused by E2E_SKIP_BUILD=1.
 */
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBuild, writeBuildMetadata } from "../e2e/support/build.ts";

async function build() {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error("The shared e2e build needs TEST_DATABASE_URL pointing at a disposable Postgres database.");
  }

  // Match the environment used by Playwright's first web server. The CI service
  // database is migrated before next build because prerendering can execute queries.
  const port = Number(process.env.E2E_PORT ?? 3100);
  Object.assign(process.env, {
    E2E: "1",
    EMAIL_TRANSPORT: "outbox",
    RESEND_API_KEY: "re_e2e_fake_key",
    RESEND_BASE_URL: `http://127.0.0.1:${process.env.E2E_FAKE_MAIL_PORT ?? 3101}/w0`,
    UI_PREVIEW_SECRET: process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret",
    CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET
      ?? "whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA==",
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    E2E_APP_URL: `http://localhost:${port}`,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${port}`,
  });
  const { resetSchema, migrate } = await import("../e2e/support/db.ts");
  await resetSchema();
  await migrate();

  // Never let an earlier compiler cache influence this production output.
  rmSync(join(process.cwd(), ".next", "cache"), { recursive: true, force: true });
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  writeBuildMetadata();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const command = process.argv[2] ?? "build";
  if (command === "build") await build();
  else if (command === "mark") writeBuildMetadata();
  else if (command === "validate") {
    process.env.NEXT_PUBLIC_APP_URL ??= `http://localhost:${process.env.E2E_PORT ?? 3100}`;
    validateBuild();
  }
  else throw new Error(`Unknown e2e build command: ${command}`);
}

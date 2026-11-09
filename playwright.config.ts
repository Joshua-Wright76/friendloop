import { defineConfig, devices } from "@playwright/test";
import { WORKERS, currentWorker, workerDatabaseUrl, workerPort } from "./e2e/support/parallel";
import { validateBuild } from "./e2e/support/build";

/**
 * Two targets, one suite:
 *   local — `npm run e2e` (boots Next against TEST_DATABASE_URL)
 *   prod  — `E2E_BASE_URL=https://friendloop.dev npx playwright test --grep @probe`
 *
 * The suite never talks to Resend locally: `EMAIL_TRANSPORT=outbox` keeps every
 * send in the outbox table, and `E2E=1` lets a test move the clock with
 * `x-e2e-now`. Production probes read the same way through a token-scoped route.
 */
// `scripts/e2e-db.mjs run` picks free ports so several suites can run at once.
const isProd = Boolean(process.env.E2E_BASE_URL);
// Keep the public build value stable when local servers use fresh random ports;
// appUrl() uses each server's runtime E2E_APP_URL for actual links.
const BUILD_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";
if (!isProd) process.env.NEXT_PUBLIC_APP_URL = BUILD_APP_URL;
if (!isProd && process.env.E2E_SKIP_BUILD === "1") validateBuild();
// Playwright loads this file again inside each worker, which is how a worker finds its own server.
const worker = currentWorker();
if (!isProd && worker !== null && worker >= WORKERS) {
  throw new Error(`Worker ${worker} has no server: only ${WORKERS} were started. Set E2E_WORKERS rather than --workers.`);
}
const TEST_PORT = workerPort(worker ?? 0);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${TEST_PORT}`;

/** The stub the provider-path tests reach through `RESEND_BASE_URL`. */
const FAKE_MAIL_URL = process.env.E2E_FAKE_MAIL_URL
  ?? `http://127.0.0.1:${process.env.E2E_FAKE_MAIL_PORT ?? 3101}`;

process.env.CRON_SECRET ??= "e2e-cron-secret";
if (!isProd) {
  process.env.E2E ??= "1";
  process.env.EMAIL_TRANSPORT ??= "outbox";
  process.env.UI_PREVIEW_SECRET ??= "e2e-preview-secret";
  // Signs the Resend webhooks the U2 flow posts; any `whsec_` + base64 works.
  process.env.RESEND_WEBHOOK_SECRET ??= "whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA==";
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
    process.env.E2E_BASE_DATABASE_URL ??= process.env.TEST_DATABASE_URL;
  }
  if (worker !== null) {
    // Tests read these directly, for their seeds, their queries and their fetches.
    process.env.E2E_PORT = String(TEST_PORT);
    if (process.env.E2E_BASE_DATABASE_URL) {
      process.env.TEST_DATABASE_URL = workerDatabaseUrl(process.env.E2E_BASE_DATABASE_URL, worker);
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    }
  }
}
const BASE_DATABASE_URL = process.env.E2E_BASE_DATABASE_URL ?? process.env.DATABASE_URL ?? "";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Each worker has its own database and server: see e2e/support/parallel.ts.
  workers: WORKERS,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"], ["./e2e/support/duration-reporter.ts"]]
    : [["list"], ["html", { open: "never" }], ["./e2e/support/duration-reporter.ts"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      // The reply form is the surface that actually ships to phones.
      name: "phone",
      testMatch: /(A2|B4|D4|D5|D6|theme-switch|a11y-phone|picker-phone)\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: isProd
    ? undefined
    : Array.from({ length: WORKERS }, (_, index) => {
        const port = workerPort(index);
        return {
          // A production build, not dev: no on-demand compilation mid-test, and the
          // suite exercises the same rendering path that ships. The first server builds
          // unless CI or e2e:fast supplied one recorded for the current source.
          command: process.env.E2E_SKIP_BUILD === "1"
            ? `npx next start -p ${port}`
            : index === 0
              ? `rm -rf .next/cache && npm run build && node scripts/e2e-build.mjs mark && npx next start -p ${port}`
              : `npx next start -p ${port}`,
          url: `http://localhost:${port}`,
          // Skipped-build local opt-in only: normal runs must always rebuild.
          reuseExistingServer: process.env.E2E_SKIP_BUILD === "1" && process.env.E2E_REUSE_SERVER === "1",
          timeout: index === 0 && process.env.E2E_SKIP_BUILD !== "1" ? 180_000 : 60_000,
          env: {
            E2E: "1",
            EMAIL_TRANSPORT: "outbox",
            // Configured as if this were production, but pointed at the stub: the
            // suite can then run `dispatch()` for real without sending mail.
            RESEND_API_KEY: "re_e2e_fake_key",
            RESEND_BASE_URL: `${FAKE_MAIL_URL}/w${index}`,
            UI_PREVIEW_SECRET: process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret",
            CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
            RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? "",
            DATABASE_URL: workerDatabaseUrl(BASE_DATABASE_URL, index),
            // NEXT_PUBLIC_ values are fixed at build time, and this differs per server.
            E2E_APP_URL: `http://localhost:${port}`,
            NEXT_PUBLIC_APP_URL: BUILD_APP_URL,
          },
        };
      }),
});

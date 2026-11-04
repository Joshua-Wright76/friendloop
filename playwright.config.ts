import { defineConfig, devices } from "@playwright/test";

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
const TEST_PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${TEST_PORT}`;
const isProd = Boolean(process.env.E2E_BASE_URL);

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
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL ??= process.env.TEST_DATABASE_URL;
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // One worker: every test truncates the same database. Parallel workers get
  // per-worker schemas when the suite is big enough to need them.
  workers: 1,
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "never" }]],
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
      testMatch: /(A2|B4|D4|D5|D6|theme-switch|a11y-phone)\.spec\.ts/,
      use: { ...devices["iPhone 13"] },
    },
  ],
  webServer: isProd
    ? undefined
    : {
        // A production build, not dev: no on-demand compilation mid-test, and the
        // suite exercises the same rendering path that ships.
        command: `npm run build && npx next start -p ${TEST_PORT}`,
        url: `http://localhost:${TEST_PORT}`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: {
          E2E: "1",
          EMAIL_TRANSPORT: "outbox",
          // Configured as if this were production, but pointed at the stub: the
          // suite can then run `dispatch()` for real without sending mail.
          RESEND_API_KEY: "re_e2e_fake_key",
          RESEND_BASE_URL: FAKE_MAIL_URL,
          UI_PREVIEW_SECRET: process.env.UI_PREVIEW_SECRET ?? "e2e-preview-secret",
          CRON_SECRET: process.env.CRON_SECRET ?? "e2e-cron-secret",
          RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET ?? "",
          DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
          NEXT_PUBLIC_APP_URL: `http://localhost:${TEST_PORT}`,
        },
      },
});

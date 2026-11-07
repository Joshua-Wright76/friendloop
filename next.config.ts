import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers.ts";
import { withSentryConfig } from "@sentry/nextjs/config";

// A local tunnel changes hostname every time it starts, so it is configured per
// machine instead of hardcoded: ALLOWED_DEV_ORIGINS="abc-123.trycloudflare.com".
const devOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  // CSP, framing, referrer, and permissions for every route; see the module for
  // why the CSP is static rather than a per-request nonce.
  async headers() {
    return securityHeaders({
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
      sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    });
  },
  // The create-a-loop wizard sends the header picture (up to 4 MB) with the form.
  // Vercel caps a request at 4.5 MB, so there is no point allowing more.
  // Not `inlineCss`: it was tried, and it repeats the stylesheet in every streamed
  // segment and the RSC payload, so a loop page's HTML went from 21 KB to 106 KB.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // The browser bundle cannot read VERCEL_ENV; bake it in so client errors are
  // tagged production / preview / development like the server's.
  env: { NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.VERCEL_ENV ?? "development" },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps upload only when SENTRY_AUTH_TOKEN is present (set it in Vercel,
// not locally or in CI); without it the build skips Sentry's upload step and
// never fails on it. No tunnel route: the browser posts to Sentry's ingest host
// directly, and securityHeaders() derives that origin from NEXT_PUBLIC_SENTRY_DSN
// for connect-src. A tunnel would spend function invocations (and the rate
// limiter's budget) on every client event to save one CSP entry.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !uploadSourceMaps,
  sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
});

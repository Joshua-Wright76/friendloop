import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry-options";

/**
 * Server and edge error tracking. Without a DSN nothing is initialized, so
 * local dev, the test suites, and CI run exactly as before. The same options
 * serve both runtimes; `@sentry/nextjs` resolves the right SDK for each.
 */
export function register() {
  // The Vercel Marketplace integration sets only NEXT_PUBLIC_SENTRY_DSN; the
  // public DSN is the same one, so the server falls back to it.
  const options = sentryOptions({
    dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV,
  });
  if (options) Sentry.init(options);
}

/** Errors Next catches in pages, route handlers, server actions, and the proxy. */
export const onRequestError = Sentry.captureRequestError;

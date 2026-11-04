/**
 * The one place Sentry's runtime options are decided, for the server, the edge,
 * and the browser. Every caller skips `Sentry.init` when this returns null, so a
 * missing DSN (local dev, tests, CI) means no client, no transport, no hooks.
 */
import type { NodeOptions } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./sentry-scrub.ts";

/** One request in ten is traced: enough to see a slow route, cheap on the free tier. */
export const TRACES_SAMPLE_RATE = 0.1;

/**
 * SDK v11 replaced `sendDefaultPii` with per-category switches whose defaults
 * collect a lot: request bodies, cookies, every header, bound SQL parameters,
 * stack-frame locals. Each is closed here; only a few inert headers survive.
 */
export const DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: { allow: ["accept", "content-type", "content-length", "host", "referer", "user-agent"] },
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
} satisfies NonNullable<NodeOptions["dataCollection"]>;

/** The subset both `Sentry.init` signatures (Node and browser) accept unchanged. */
type SharedOptions = Pick<
  NodeOptions,
  | "dsn"
  | "environment"
  | "dataCollection"
  | "tracesSampleRate"
  | "beforeSend"
  | "beforeSendSpan"
  | "beforeBreadcrumb"
>;

export function sentryOptions(input: {
  dsn: string | undefined;
  environment: string | undefined;
}): SharedOptions | null {
  const dsn = input.dsn?.trim();
  if (!dsn) return null;
  return {
    dsn,
    // VERCEL_ENV: production | preview (dev.friendloop.dev and PR previews) | development.
    environment: input.environment || "development",
    // Private friend-group content: no IPs, no cookies, no request bodies.
    dataCollection: DATA_COLLECTION,
    tracesSampleRate: TRACES_SAMPLE_RATE,
    beforeSend: scrubEvent,
    beforeSendSpan: scrubSpan,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}

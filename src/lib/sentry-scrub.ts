/**
 * What leaves the building in an error report.
 *
 * Friendloop's URLs are credentials: `/r/<token>` *is* a contributor's sign-in,
 * `/s/<token>` opens a shared issue, `?m=` and `?token=` carry the same weight.
 * Sentry would otherwise record them in request URLs, breadcrumbs, span
 * attributes, and error messages. Everything here is pure so it runs the same in
 * the browser, the Node server, and the edge, and is unit tested without Sentry.
 */
import type { Breadcrumb, Event, NodeOptions } from "@sentry/nextjs";

type StreamedSpan = Parameters<NonNullable<NodeOptions["beforeSendSpan"]>>[0];

export const REDACTED = "[Filtered]";

/** Path segments that are followed by a credential, e.g. `/r/<token>`. */
const TOKEN_PATHS = /(\/(?:r|s|u|api\/reply|api\/suggest)\/)(?!\[token\])[^/?#\s"'<>]+/g;
/** Every query value: the keys stay readable, the values never leave. */
const QUERY_VALUES = /([?&][^=&#\s"'<>]+=)[^&#\s"'<>]*/g;

/** Headers that carry a session, a secret, or the visitor's address. */
const DROPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-forwarded-for",
  "x-real-ip",
  "x-vercel-forwarded-for",
  "x-vercel-proxied-for",
]);

/** Redact credentials from one string: token path segments and query values. */
export function scrubText(value: string): string {
  return value.replace(TOKEN_PATHS, "$1[token]").replace(QUERY_VALUES, `$1${REDACTED}`);
}

/**
 * Walk a JSON-ish value and scrub every string in it. Bounded so a cycle cannot
 * hang; anything nested past the bound is replaced rather than sent unscrubbed.
 */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (typeof value === "string") return scrubText(value) as T;
  if (value === null || typeof value !== "object") return value;
  if (depth > 12) return REDACTED as T;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1)) as T;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key] = scrubDeep(inner, depth + 1);
  return out as T;
}

/**
 * `beforeSend`. Drops request bodies, cookies, and
 * credential headers outright, then scrubs every remaining string.
 */
export function scrubEvent<E extends Event>(event: E): E {
  const scrubbed = scrubDeep(event);
  delete scrubbed.user;
  const request = scrubbed.request;
  if (request) {
    delete request.cookies;
    delete request.data;
    // A bare `a=1&b=2` has no leading `?` for scrubText to anchor on.
    if (typeof request.query_string === "string") {
      request.query_string = scrubText(`?${request.query_string}`).slice(1);
    } else {
      delete request.query_string;
    }
    if (request.headers) {
      for (const name of Object.keys(request.headers)) {
        if (DROPPED_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith("x-e2e-")) {
          delete request.headers[name];
        }
      }
    }
  }
  return scrubbed;
}

/** `beforeBreadcrumb`: navigation and fetch breadcrumbs carry full URLs. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return scrubDeep(breadcrumb);
}

/**
 * `beforeSendSpan`. SDK v11 streams spans by default and skips
 * `beforeSendTransaction`, so span names and attributes (`url.full`,
 * `http.target`, …) are scrubbed here instead.
 */
export function scrubSpan(span: StreamedSpan): StreamedSpan {
  return scrubDeep(span);
}

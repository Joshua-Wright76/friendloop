/**
 * Response headers for every route, built once when `next.config.ts` loads.
 *
 * They are static headers rather than a per-request proxy on purpose: a nonce
 * CSP forces every page to render dynamically, and Next's CSP guide calls that
 * incompatible with Partial Prerendering — Cache Components' static shells and
 * the partial prefetches the navigation budget depends on. So scripts are held
 * to this origin, and the inline scripts Next streams (and the theme script in
 * the root layout) run under 'unsafe-inline'. Hashes cannot replace that: the
 * streamed flight-data scripts differ on every page, and a single hash in the
 * list would make browsers ignore 'unsafe-inline' and block them.
 */

export type HeaderEnv = {
  /** `process.env.NODE_ENV` — development needs eval and the HMR socket. */
  nodeEnv?: string;
  /** `process.env.VERCEL_ENV` — production, preview, or unset when local. */
  vercelEnv?: string;
  /**
   * `process.env.NEXT_PUBLIC_SENTRY_DSN` — the browser SDK posts events to the
   * DSN's ingest host, so connect-src admits exactly that origin when it is set.
   */
  sentryDsn?: string;
};

type Header = { key: string; value: string };
export type HeaderRule = { source: string; headers: Header[] };

/** Public Vercel Blob stores: reply photos, avatars, and voice notes. */
const BLOB_HOSTS = "https://*.public.blob.vercel-storage.com https://*.blob.vercel-storage.com";
/** `@vercel/blob/client` PUTs photos here directly from the browser. */
const BLOB_UPLOAD_API = "https://vercel.com/api/blob/";
/** The Vercel toolbar is injected into preview deployments (dev.friendloop.dev). */
const VERCEL_LIVE = "https://vercel.live";

/**
 * Pages whose URL carries a credential or whose content is somebody's loop.
 * They send no Referer at all — not even the origin — on top of the site-wide
 * policy, which already strips the path from every cross-origin request.
 */
export const PRIVATE_ROUTES = [
  "/r/:path*",
  "/u/:path*",
  "/s/:path*",
  "/i/:path*",
  "/g/:path*",
  "/album/:path*",
  "/you/:path*",
  "/signin/:path*",
  "/dev/:path*",
] as const;

/**
 * The origin the browser SDK sends events to, e.g. `https://o123.ingest.us.sentry.io`
 * for `https://key@o123.ingest.us.sentry.io/456`. Null without a usable DSN —
 * the SDK stays off then, so there is nothing to allow.
 */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  const value = dsn?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function contentSecurityPolicy({ nodeEnv, vercelEnv, sentryDsn }: HeaderEnv): string {
  const dev = nodeEnv === "development";
  const preview = vercelEnv === "preview";
  // Only deployed environments are served over HTTPS; upgrading on a local
  // `next start` (the e2e suite) would send WebKit to https://localhost.
  const deployed = vercelEnv === "production" || preview;
  const live = (...sources: string[]) => (preview ? sources : []);
  const sentry = sentryIngestOrigin(sentryDsn);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), ...live(VERCEL_LIVE)],
    "style-src": ["'self'", "'unsafe-inline'", ...live(VERCEL_LIVE)],
    // Link artwork comes from whichever CDN Spotify, Bandcamp, or Qobuz names
    // in its metadata, so images may load from any HTTPS host. An image cannot
    // run script; the directives that stop injection are script-src and base-uri.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", BLOB_HOSTS],
    "font-src": ["'self'", "data:", ...live(VERCEL_LIVE, "https://assets.vercel.com")],
    "connect-src": [
      "'self'",
      BLOB_UPLOAD_API,
      ...(sentry ? [sentry] : []),
      ...(dev ? ["ws:", "wss:"] : []),
      ...live(VERCEL_LIVE, "wss://ws-us3.pusher.com"),
    ],
    "frame-src": ["'self'", ...live(VERCEL_LIVE)],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`);
  if (deployed) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/**
 * The reply sheet records voice notes, so the microphone stays available to
 * this origin. Nothing uses the camera — photos come through a file picker,
 * which needs no permission — so it is denied with everything else.
 */
export const PERMISSIONS_POLICY = [
  "microphone=(self)",
  "camera=()",
  "geolocation=()",
  "payment=()",
  "usb=()",
  "midi=()",
  "magnetometer=()",
  "gyroscope=()",
  "accelerometer=()",
  "display-capture=()",
  "browsing-topics=()",
].join(", ");

export function securityHeaders(env: HeaderEnv): HeaderRule[] {
  const everywhere: Header[] = [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // frame-ancestors covers current browsers; X-Frame-Options covers the rest.
    { key: "X-Frame-Options", value: "DENY" },
    // The browser default, stated so a proxy cannot loosen it: cross-origin
    // requests get the origin only, never a path or a query.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
  ];
  // HSTS pins the production domain (and dev.friendloop.dev beneath it) to
  // HTTPS. Never on a local or preview host, where it would outlive the test.
  if (env.vercelEnv === "production") {
    everywhere.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  }
  // Preview deployments hold throwaway data — keep them out of search results.
  if (env.vercelEnv === "preview") {
    everywhere.push({ key: "X-Robots-Tag", value: "noindex, nofollow" });
  }

  // Later rules override earlier ones for the same key.
  return [
    { source: "/:path*", headers: everywhere },
    ...PRIVATE_ROUTES.map((source) => ({
      source,
      headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
    })),
  ];
}

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contentSecurityPolicy,
  PERMISSIONS_POLICY,
  PRIVATE_ROUTES,
  securityHeaders,
  sentryIngestOrigin,
} from "./security-headers.ts";

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((directive) => {
      const [name, ...sources] = directive.split(" ");
      return [name, sources] as const;
    }),
  );
}

function headersFor(rules: ReturnType<typeof securityHeaders>, source: string) {
  return Object.fromEntries((rules.find((rule) => rule.source === source)?.headers ?? []).map((h) => [h.key, h.value]));
}

test("production locks scripts to this origin and forbids framing, plugins, and base rewrites", () => {
  const csp = directives(contentSecurityPolicy({ nodeEnv: "production", vercelEnv: "production" }));
  assert.deepEqual(csp.get("script-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("base-uri"), ["'self'"]);
  assert.deepEqual(csp.get("form-action"), ["'self'"]);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.ok(csp.get("media-src")?.includes("https://*.public.blob.vercel-storage.com"));
  assert.ok(csp.get("connect-src")?.includes("https://vercel.com/api/blob/"));
  assert.ok(csp.has("upgrade-insecure-requests"));
  assert.ok(!csp.get("script-src")?.some((source) => source.includes("vercel.live")));
});

test("development allows eval and the HMR socket, and never upgrades localhost", () => {
  const csp = directives(contentSecurityPolicy({ nodeEnv: "development" }));
  assert.ok(csp.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(csp.get("connect-src")?.includes("ws:"));
  assert.ok(!csp.has("upgrade-insecure-requests"));
});

test("a local production build (the e2e suite) has no eval and no upgrade", () => {
  const csp = directives(contentSecurityPolicy({ nodeEnv: "production" }));
  assert.ok(!csp.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(!csp.has("upgrade-insecure-requests"));
});

test("previews admit the Vercel toolbar", () => {
  const csp = directives(contentSecurityPolicy({ nodeEnv: "production", vercelEnv: "preview" }));
  for (const name of ["script-src", "style-src", "connect-src", "frame-src", "font-src"]) {
    assert.ok(csp.get(name)?.includes("https://vercel.live"), name);
  }
  assert.ok(csp.has("upgrade-insecure-requests"));
});

test("every route gets the base headers; HSTS only in production", () => {
  const prod = headersFor(securityHeaders({ nodeEnv: "production", vercelEnv: "production" }), "/:path*");
  assert.equal(prod["X-Content-Type-Options"], "nosniff");
  assert.equal(prod["X-Frame-Options"], "DENY");
  assert.equal(prod["Referrer-Policy"], "strict-origin-when-cross-origin");
  assert.equal(prod["Permissions-Policy"], PERMISSIONS_POLICY);
  assert.match(prod["Strict-Transport-Security"], /max-age=\d+/);
  assert.equal(prod["X-Robots-Tag"], undefined);

  const preview = headersFor(securityHeaders({ vercelEnv: "preview" }), "/:path*");
  assert.equal(preview["Strict-Transport-Security"], undefined);
  assert.equal(preview["X-Robots-Tag"], "noindex, nofollow");

  const local = headersFor(securityHeaders({ nodeEnv: "development" }), "/:path*");
  assert.equal(local["Strict-Transport-Security"], undefined);
  assert.equal(local["X-Robots-Tag"], undefined);
});

test("credential and loop routes send no referrer, after the site-wide rule", () => {
  const rules = securityHeaders({ nodeEnv: "production" });
  assert.equal(rules[0].source, "/:path*");
  for (const source of ["/r/:path*", "/u/:path*", "/s/:path*", "/i/:path*", "/album/:path*", "/signin/:path*", "/join/:path*"]) {
    assert.ok((PRIVATE_ROUTES as readonly string[]).includes(source), source);
    assert.equal(headersFor(rules, source)["Referrer-Policy"], "no-referrer");
  }
});

test("the microphone stays with this origin; the camera is denied", () => {
  assert.match(PERMISSIONS_POLICY, /microphone=\(self\)/);
  assert.match(PERMISSIONS_POLICY, /camera=\(\)/);
});

test("connect-src admits the Sentry ingest origin named by the DSN, and nothing without one", () => {
  const dsn = "https://abc123@o4507.ingest.us.sentry.io/4508";
  const withDsn = directives(contentSecurityPolicy({ nodeEnv: "production", vercelEnv: "production", sentryDsn: dsn }));
  assert.ok(withDsn.get("connect-src")?.includes("https://o4507.ingest.us.sentry.io"));
  assert.ok(!withDsn.get("connect-src")?.some((source) => source.includes("abc123") || source.includes("4508")));

  for (const sentryDsn of [undefined, "", "  ", "not a url", "http://key@o1.ingest.sentry.io/2"]) {
    const csp = directives(contentSecurityPolicy({ nodeEnv: "production", sentryDsn }));
    assert.ok(!csp.get("connect-src")?.some((source) => source.includes("sentry")), String(sentryDsn));
  }
});

test("sentryIngestOrigin strips the key and project from a DSN", () => {
  assert.equal(sentryIngestOrigin(" https://k@o1.ingest.de.sentry.io/9 "), "https://o1.ingest.de.sentry.io");
  assert.equal(sentryIngestOrigin(undefined), null);
});

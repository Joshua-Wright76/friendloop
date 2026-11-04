import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorEvent } from "@sentry/nextjs";
import { REDACTED, scrubBreadcrumb, scrubDeep, scrubEvent, scrubSpan, scrubText } from "./sentry-scrub.ts";
import { DATA_COLLECTION, sentryOptions, TRACES_SAMPLE_RATE } from "./sentry-options.ts";

const TOKEN = "Zx9_secret-Token";

test("reply, share, unsubscribe, and API tokens are redacted from paths", () => {
  assert.equal(scrubText(`https://friendloop.dev/r/${TOKEN}`), "https://friendloop.dev/r/[token]");
  assert.equal(scrubText(`/r/${TOKEN}/suggest`), "/r/[token]/suggest");
  assert.equal(scrubText(`/s/${TOKEN}`), "/s/[token]");
  assert.equal(scrubText(`/u/${TOKEN}#top`), "/u/[token]#top");
  assert.equal(scrubText(`POST /api/reply/${TOKEN}/photo`), "POST /api/reply/[token]/photo");
  assert.equal(scrubText(`/api/suggest/${TOKEN}`), "/api/suggest/[token]");
  assert.equal(scrubText(`fetch failed for "/r/${TOKEN}"`), `fetch failed for "/r/[token]"`);
});

test("parameterized route names and ordinary paths are left alone", () => {
  assert.equal(scrubText("/r/[token]/suggest"), "/r/[token]/suggest");
  assert.equal(scrubText("/g/1234/settings"), "/g/1234/settings");
  assert.equal(scrubText("/dev/screens"), "/dev/screens");
  assert.equal(scrubText("Cannot read properties of undefined"), "Cannot read properties of undefined");
});

test("query values are redacted but their keys stay readable", () => {
  assert.equal(scrubText(`/i/abc?m=${TOKEN}`), `/i/abc?m=${REDACTED}`);
  assert.equal(
    scrubText(`/signin/confirm?token=${TOKEN}&next=/g/1`),
    `/signin/confirm?token=${REDACTED}&next=${REDACTED}`,
  );
});

test("scrubDeep reaches nested strings and leaves other values intact", () => {
  const input = { a: [`/r/${TOKEN}`, 3, null, true], b: { c: `/s/${TOKEN}` }, d: undefined };
  assert.deepEqual(scrubDeep(input), { a: ["/r/[token]", 3, null, true], b: { c: "/s/[token]" }, d: undefined });

  let deep: Record<string, unknown> = { leaf: `/r/${TOKEN}` };
  for (let index = 0; index < 20; index += 1) deep = { next: deep };
  // Bounded: past the depth limit the value is dropped, never walked forever or sent raw.
  const scrubbed = JSON.stringify(scrubDeep(deep));
  assert.ok(!scrubbed.includes(TOKEN));
  assert.ok(scrubbed.includes(REDACTED));
});

test("scrubEvent drops cookies, bodies, user, and credential headers", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: `Failed on /r/${TOKEN}`,
    user: { ip_address: "203.0.113.9" },
    request: {
      url: `https://friendloop.dev/api/reply/${TOKEN}`,
      query_string: `m=${TOKEN}`,
      cookies: { fl_session: "secret" },
      data: { body: "what I wrote this week" },
      headers: {
        Cookie: "fl_session=secret",
        authorization: "Bearer cron",
        "x-forwarded-for": "203.0.113.9",
        "x-e2e-now": "2026-01-01",
        referer: `https://friendloop.dev/r/${TOKEN}`,
        "user-agent": "test",
      },
    },
    exception: { values: [{ type: "Error", value: `GET /s/${TOKEN} 500` }] },
    breadcrumbs: [{ category: "navigation", data: { from: `/r/${TOKEN}`, to: "/" } }],
  };

  const scrubbed = scrubEvent(event);
  assert.equal(scrubbed.user, undefined);
  assert.equal(scrubbed.message, "Failed on /r/[token]");
  assert.equal(scrubbed.request?.url, "https://friendloop.dev/api/reply/[token]");
  assert.equal(scrubbed.request?.query_string, `m=${REDACTED}`);
  assert.equal(scrubbed.request?.cookies, undefined);
  assert.equal(scrubbed.request?.data, undefined);
  assert.deepEqual(scrubbed.request?.headers, {
    referer: "https://friendloop.dev/r/[token]",
    "user-agent": "test",
  });
  assert.equal(scrubbed.exception?.values?.[0].value, "GET /s/[token] 500");
  assert.equal(scrubbed.breadcrumbs?.[0].data?.from, "/r/[token]");
  assert.ok(!JSON.stringify(scrubbed).includes(TOKEN));
});

test("scrubEvent copes with an event that has no request", () => {
  const event: ErrorEvent = { type: undefined, message: "plain" };
  assert.deepEqual(scrubEvent(event), { type: undefined, message: "plain" });
  const noHeaders: ErrorEvent = { type: undefined, request: { url: `/r/${TOKEN}` } };
  assert.deepEqual(scrubEvent(noHeaders).request, { url: "/r/[token]" });
  const pairs: ErrorEvent = { type: undefined, request: { query_string: [["m", TOKEN]] } };
  assert.deepEqual(scrubEvent(pairs).request, {});
});

test("scrubBreadcrumb redacts fetch URLs", () => {
  const crumb = scrubBreadcrumb({ category: "fetch", data: { url: `/api/reply/${TOKEN}`, method: "POST" } });
  assert.deepEqual(crumb.data, { url: "/api/reply/[token]", method: "POST" });
});

test("scrubSpan redacts the span name and URL attributes", () => {
  const span = scrubSpan({
    trace_id: "t",
    span_id: "s",
    name: `GET /r/${TOKEN}`,
    start_timestamp: 1,
    status: "ok",
    is_segment: true,
    attributes: { "url.full": `https://friendloop.dev/i/x?m=${TOKEN}`, "http.response.status_code": 200 },
  });
  assert.equal(span.name, "GET /r/[token]");
  assert.deepEqual(span.attributes, {
    "url.full": `https://friendloop.dev/i/x?m=${REDACTED}`,
    "http.response.status_code": 200,
  });
});

test("sentryOptions is null without a DSN, so nothing initializes", () => {
  assert.equal(sentryOptions({ dsn: undefined, environment: "production" }), null);
  assert.equal(sentryOptions({ dsn: "  ", environment: "production" }), null);
});

test("sentryOptions keeps PII off and wires the scrubbers", () => {
  const options = sentryOptions({ dsn: " https://key@o1.ingest.sentry.io/2 ", environment: "preview" });
  assert.ok(options);
  assert.equal(options.dsn, "https://key@o1.ingest.sentry.io/2");
  assert.equal(options.environment, "preview");
  assert.equal(options.dataCollection, DATA_COLLECTION);
  assert.equal(DATA_COLLECTION.userInfo, false);
  assert.equal(DATA_COLLECTION.cookies, false);
  assert.deepEqual(DATA_COLLECTION.httpBodies, []);
  assert.equal(DATA_COLLECTION.databaseQueryData, false);
  assert.equal(DATA_COLLECTION.stackFrameVariables, false);
  assert.ok(!DATA_COLLECTION.httpHeaders.allow.includes("cookie"));
  assert.equal(options.tracesSampleRate, TRACES_SAMPLE_RATE);
  assert.equal(options.beforeSend, scrubEvent);
  assert.equal(options.beforeSendSpan, scrubSpan);
  assert.equal(options.beforeBreadcrumb, scrubBreadcrumb);
  assert.equal(sentryOptions({ dsn: "https://k@o1.ingest.sentry.io/2", environment: undefined })?.environment, "development");
});

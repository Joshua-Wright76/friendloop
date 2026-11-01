import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { appUrl, issueUrl, replyUrl, shareUrl, signInUrl, url } from "./urls.ts";

const VERCEL_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_PROJECT_PRODUCTION_URL",
] as const;

const saved: Partial<Record<(typeof VERCEL_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const key of VERCEL_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

function restore() {
  for (const key of VERCEL_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

test("a local run falls back to localhost", (t) => {
  t.after(restore);
  restore();
  for (const key of VERCEL_KEYS) delete process.env[key];
  assert.equal(appUrl(), "http://localhost:3000");
});

test("NEXT_PUBLIC_APP_URL wins, with a trailing slash removed", (t) => {
  t.after(restore);
  process.env.NEXT_PUBLIC_APP_URL = "https://friendloop.dev/";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "ignored.example";
  assert.equal(appUrl(), "https://friendloop.dev");
});

test("a preview links to itself, never to production", (t) => {
  t.after(restore);
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_URL = "abc-123.vercel.app";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "friendloop.dev";
  assert.equal(appUrl(), "https://abc-123.vercel.app");
});

test("production uses the stable project domain before the deployment URL", (t) => {
  t.after(restore);
  process.env.VERCEL_ENV = "production";
  process.env.VERCEL_PROJECT_PRODUCTION_URL = "friendloop.dev";
  process.env.VERCEL_URL = "deployment-xyz.vercel.app";
  assert.equal(appUrl(), "https://friendloop.dev");
});

test("with only a deployment URL, that is used", (t) => {
  t.after(restore);
  process.env.VERCEL_URL = "deployment-xyz.vercel.app";
  assert.equal(appUrl(), "https://deployment-xyz.vercel.app");
});

test("the path helpers build the urls the emails carry", (t) => {
  t.after(restore);
  process.env.NEXT_PUBLIC_APP_URL = "https://friendloop.dev";

  assert.equal(url("/g/1"), "https://friendloop.dev/g/1");
  assert.equal(url("g/1"), "https://friendloop.dev/g/1");
  assert.equal(replyUrl("tok"), "https://friendloop.dev/r/tok");
  assert.equal(shareUrl("tok"), "https://friendloop.dev/s/tok");
  assert.equal(issueUrl("issue-1"), "https://friendloop.dev/i/issue-1");
  assert.equal(
    issueUrl("issue-1", "a b&c"),
    "https://friendloop.dev/i/issue-1?m=a%20b%26c",
  );
  assert.equal(
    signInUrl("a b&c"),
    "https://friendloop.dev/signin/confirm?token=a%20b%26c",
  );
});

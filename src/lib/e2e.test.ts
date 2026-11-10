import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { e2eSeamsAllowed, secureCookies } from "./e2e.ts";

const KEYS = ["NODE_ENV", "E2E", "VERCEL_ENV"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const env = process.env as Record<string, string | undefined>;

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>): void {
  for (const key of KEYS) {
    if (values[key] === undefined) delete env[key];
    else env[key] = values[key];
  }
}

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
});

test("cookies are Secure wherever the app is really served", () => {
  setEnv({ NODE_ENV: "production" });
  assert.equal(secureCookies(), true);
  setEnv({ NODE_ENV: "production", VERCEL_ENV: "preview" });
  assert.equal(secureCookies(), true);
  // A production deployment that inherits E2E=1 by accident keeps them Secure.
  setEnv({ NODE_ENV: "production", E2E: "1", VERCEL_ENV: "production" });
  assert.equal(e2eSeamsAllowed(), false);
  assert.equal(secureCookies(), true);
});

test("the suite's plain-http server, and development, send them without it", () => {
  setEnv({ NODE_ENV: "production", E2E: "1" });
  assert.equal(e2eSeamsAllowed(), true);
  assert.equal(secureCookies(), false);
  setEnv({ NODE_ENV: "development" });
  assert.equal(secureCookies(), false);
});

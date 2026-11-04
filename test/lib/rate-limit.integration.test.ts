import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { clientIp, consume, LIMITS, pruneRateLimits, requestIp } from "../../src/lib/rate-limit.ts";
import { E2E_NOW, rows, setupDatabase } from "../support/app.ts";
import { clearRequest, setRequestBroken, setRequestHeaders } from "../stubs/request.mjs";

setupDatabase();

beforeEach(() => {
  clearRequest();
  setRequestBroken(false);
  setRequestHeaders({ "x-e2e-now": E2E_NOW.toISOString() });
});

const MINUTE = 60 * 1000;
const limit = { max: 3, windowMs: 10 * MINUTE };
/** The first instant of the window E2E_NOW sits in. */
const windowStart = new Date(Math.floor(E2E_NOW.getTime() / limit.windowMs) * limit.windowMs);

test("allows up to max in a window, then refuses, and refused attempts still count", async () => {
  const counts = [];
  for (let i = 0; i < 5; i++) counts.push(await consume("t:a", limit, E2E_NOW));
  assert.deepEqual(counts.map((r) => r.allowed), [true, true, true, false, false]);
  assert.deepEqual(counts.map((r) => r.count), [1, 2, 3, 4, 5]);
  assert.equal(counts[0].resetAt.getTime(), windowStart.getTime() + limit.windowMs);
});

test("keys are independent", async () => {
  for (let i = 0; i < 3; i++) await consume("t:a", limit, E2E_NOW);
  assert.equal((await consume("t:a", limit, E2E_NOW)).allowed, false);
  assert.equal((await consume("t:b", limit, E2E_NOW)).allowed, true);
});

test("the window rolls over on its boundary, not a moment before", async () => {
  const lastMoment = new Date(windowStart.getTime() + limit.windowMs - 1);
  for (let i = 0; i < 3; i++) await consume("t:a", limit, windowStart);
  assert.equal((await consume("t:a", limit, lastMoment)).allowed, false);

  const next = await consume("t:a", limit, new Date(windowStart.getTime() + limit.windowMs));
  assert.deepEqual([next.allowed, next.count], [true, 1]);
  const [row] = await rows<{ count: number; window_start: Date }>("select count, window_start from rate_limits");
  assert.equal(row.count, 1);
  assert.equal(new Date(row.window_start).getTime(), windowStart.getTime() + limit.windowMs);
});

test("simultaneous attempts each get their own count", async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => consume("t:race", limit, E2E_NOW)));
  assert.deepEqual(results.map((r) => r.count).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(results.filter((r) => r.allowed).length, 3);
});

test("without an explicit instant it reads the request clock", async () => {
  const later = new Date(E2E_NOW.getTime() + 3 * LIMITS.signInEmail.windowMs);
  setRequestHeaders({ "x-e2e-now": later.toISOString() });
  const result = await consume("t:clock", LIMITS.signInEmail);
  assert.ok(result.resetAt.getTime() > later.getTime());
  assert.ok(result.resetAt.getTime() <= later.getTime() + LIMITS.signInEmail.windowMs);
});

test("pruning drops closed windows and keeps open ones", async () => {
  await consume("t:old", limit, new Date(E2E_NOW.getTime() - limit.windowMs));
  await consume("t:live", limit, E2E_NOW);
  assert.equal(await pruneRateLimits(E2E_NOW), 1);
  const left = await rows<{ key: string }>("select key from rate_limits");
  assert.deepEqual(left.map((r) => r.key), ["t:live"]);
});

test("the client address comes from the proxy headers", async () => {
  assert.equal(clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" })), "203.0.113.7");
  assert.equal(clientIp(new Headers({ "x-real-ip": " 198.51.100.2 " })), "198.51.100.2");
  assert.equal(clientIp(new Headers({ "x-forwarded-for": "", "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(clientIp(new Headers()), "unknown");

  setRequestHeaders({ "x-forwarded-for": "203.0.113.9" });
  assert.equal(await requestIp(), "203.0.113.9");
  setRequestBroken(true);
  assert.equal(await requestIp(), "unknown");
});

test("the sweep clears closed windows", async () => {
  const { sweep } = await import("../../src/lib/sweep.ts");
  await consume("t:old", limit, new Date(E2E_NOW.getTime() - limit.windowMs));
  await sweep({ at: E2E_NOW });
  assert.equal((await rows("select key from rate_limits")).length, 0);
});

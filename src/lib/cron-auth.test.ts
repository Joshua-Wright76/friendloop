import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "./cron-auth.ts";

const original = process.env.CRON_SECRET;
afterEach(() => {
  if (original === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = original;
});

const request = (authorization?: string) =>
  new Request("https://friendloop.dev/api/health", {
    headers: authorization ? { authorization } : {},
  });

test("the matching bearer token is authorized", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isCronAuthorized(request("Bearer s3cret")), true);
});

test("a wrong or missing token is refused", () => {
  process.env.CRON_SECRET = "s3cret";
  assert.equal(isCronAuthorized(request("Bearer nope")), false);
  assert.equal(isCronAuthorized(request()), false);
});

test("with no secret configured nothing is authorized, not everything", () => {
  delete process.env.CRON_SECRET;
  assert.equal(isCronAuthorized(request("Bearer undefined")), false);
  assert.equal(isCronAuthorized(request()), false);
});

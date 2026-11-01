import { test } from "node:test";
import assert from "node:assert/strict";
import { seedLoop, AFTER_FIRST_SLOT, rows, setupDatabase } from "../support/app.ts";
import { getNow } from "../../src/lib/clock.ts";
import { setRequestHeaders, clearRequest } from "../stubs/request.mjs";

setupDatabase();

test("the fake clock is opt-in: no header, no override", async () => {
  clearRequest();
  const before = Date.now();
  const at = await getNow();
  assert.ok(Math.abs(at.getTime() - before) < 5_000);
});

test("x-e2e-now moves the app clock when E2E=1", async () => {
  setRequestHeaders({ "x-e2e-now": "2026-01-02T08:05:00.000Z" });
  assert.equal((await getNow()).toISOString(), AFTER_FIRST_SLOT.toISOString());
});

test("a malformed override is ignored rather than fatal", async () => {
  setRequestHeaders({ "x-e2e-now": "not-a-date" });
  const at = await getNow();
  assert.ok(Math.abs(at.getTime() - Date.now()) < 5_000);
});

test("the seed fixtures do not need the framework", async () => {
  const loop = await seedLoop();
  const [row] = await rows<{ count: number }>("select count(*)::int as count from memberships where group_id = $1", [
    loop.groupId,
  ]);
  assert.equal(row.count, 3);
});

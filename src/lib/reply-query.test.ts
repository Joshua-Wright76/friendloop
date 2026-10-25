import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { replyHasContentCondition } from "./reply-query.ts";

test("submitting a reply counts either non-empty text or a photo URL", () => {
  const { sql } = new PgDialect().sqlToQuery(replyHasContentCondition());
  assert.match(sql, /body.*<> ''/);
  assert.match(sql, /"photo_url" is not null/i);
  assert.match(sql, /\sor\s/i);
});

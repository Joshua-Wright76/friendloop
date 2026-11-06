import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { replyHasContentCondition } from "./reply-query.ts";

test("submitting a reply counts non-empty text, a photo URL, a voice note, or a poll pick", () => {
  const { sql } = new PgDialect().sqlToQuery(replyHasContentCondition());
  assert.match(sql, /body.*<> ''/);
  assert.match(sql, /"photo_url" is not null/i);
  assert.match(sql, /"audio_url" is not null/i);
  assert.match(sql, /jsonb_array_length\("replies"\."poll_choices"\) > 0/);
  assert.match(sql, /\sor\s/i);
});

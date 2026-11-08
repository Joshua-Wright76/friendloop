import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { answeredCountSql, replyHasContentCondition, replyHasContentSql } from "./reply-query.ts";

const render = (query: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(query).sql;

test("an answer is non-blank text, a photo, a voice note, a poll pick, a music link or a wall photo, never a draft left unsent", () => {
  const sql = render(replyHasContentCondition());
  assert.match(sql, /"replies"\."body" ~ '\\S'/, "spaces alone are not an answer");
  assert.match(sql, /"photo_url" is not null/i);
  assert.match(sql, /"audio_url" is not null/i);
  assert.match(sql, /jsonb_array_length\("replies"\."poll_choices"\) > 0/);
  assert.match(sql, /"link_url" is not null/i);
  assert.match(sql, /exists \(select 1 from "reply_media"/);
  assert.match(sql, /"replies"\."never_sent" = \$1/);
  assert.doesNotMatch(sql, /status/, "nothing reads the old status");
  assert.doesNotMatch(sql, /section_/, "one rule, one table");
});

test("the hand-written forms say the same thing over an alias", () => {
  const rule = render(replyHasContentSql("r"));
  assert.match(rule, /not r\.never_sent and \(r\.body ~ '\\S' or r\.photo_url is not null/);
  assert.match(rule, /r\.link_url is not null or exists \(select 1 from reply_media rm_any where rm_any\.reply_id = r\.id\)/);
  const count = render(answeredCountSql("i"));
  assert.match(count, /count\(distinct r\.membership_id\)/);
  assert.match(count, /r\.issue_id = i\.id/);
  assert.doesNotMatch(count, /section_replies/);
});

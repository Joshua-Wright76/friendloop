import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  answeredCountSql,
  replyHasContentCondition,
  replyHasContentSql,
  sectionReplyHasContentCondition,
  sectionReplyHasContentSql,
} from "./reply-query.ts";

const render = (query: Parameters<PgDialect["sqlToQuery"]>[0]) => new PgDialect().sqlToQuery(query).sql;

test("an answer is non-blank text, a photo URL, a voice note, or a poll pick, never a draft left unsent", () => {
  const sql = render(replyHasContentCondition());
  assert.match(sql, /"replies"\."body" ~ '\\S'/, "spaces alone are not an answer");
  assert.match(sql, /"photo_url" is not null/i);
  assert.match(sql, /"audio_url" is not null/i);
  assert.match(sql, /jsonb_array_length\("replies"\."poll_choices"\) > 0/);
  assert.match(sql, /"replies"\."never_sent" = \$1/);
  assert.doesNotMatch(sql, /status/, "nothing reads the old status");
});

test("a section answer is non-blank text, a music link, or a photo", () => {
  const sql = render(sectionReplyHasContentCondition());
  assert.match(sql, /"section_replies"\."body" ~ '\\S'/);
  assert.match(sql, /"link_url" is not null/i);
  assert.match(sql, /exists \(select 1 from "section_media"/);
  assert.doesNotMatch(sql, /status/);
});

test("the hand-written forms say the same thing over an alias", () => {
  assert.match(render(replyHasContentSql("r")), /not r\.never_sent and \(r\.body ~ '\\S' or r\.photo_url is not null/);
  assert.match(render(sectionReplyHasContentSql("sr")), /not sr\.never_sent and \(sr\.body ~ '\\S' or sr\.link_url is not null/);
  const count = render(answeredCountSql("i"));
  assert.match(count, /r\.issue_id = i\.id/);
  assert.match(count, /union/);
  assert.match(count, /sr\.issue_id = i\.id/);
});

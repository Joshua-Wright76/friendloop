import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { replies, sectionMedia, sectionReplies } from "../db/schema.ts";

/*
 * What someone has written is in. A saved answer that isn't empty goes out with
 * the round and counts everywhere an answer counts: delivery, the round's page,
 * progress, reminders, the album and exports. An answer cleared back to nothing
 * isn't one. These are the only definitions; nothing reads `status` any more.
 *
 * `never_sent` marks drafts left behind in rounds that went out before answers
 * saved themselves into the round. They were never part of it and never will be.
 */

/** Text with something other than spaces in it. */
const written = (column: typeof replies.body | typeof sectionReplies.body) => sql`${column} ~ '\\S'`;

/** An answer can be text, a photo, a voice note, a poll pick, or any mix of them. */
export function replyHasContentCondition(): SQL {
  const content = or(
    written(replies.body),
    isNotNull(replies.photoUrl),
    isNotNull(replies.audioUrl),
    sql`jsonb_array_length(${replies.pollChoices}) > 0`,
  );
  const condition = and(eq(replies.neverSent, false), content);
  if (!condition) throw new Error("Reply content condition is empty.");
  return condition;
}

/** A section answer is its text or caption, a music link, or at least one photo. */
export function sectionReplyHasContentCondition(): SQL {
  const content = or(
    written(sectionReplies.body),
    isNotNull(sectionReplies.linkUrl),
    sql`exists (select 1 from ${sectionMedia} where ${sectionMedia.sectionReplyId} = ${sectionReplies.id})`,
  );
  const condition = and(eq(sectionReplies.neverSent, false), content);
  if (!condition) throw new Error("Section reply content condition is empty.");
  return condition;
}

/** The same rule for hand-written SQL, over a `replies` row aliased as `alias`. */
export function replyHasContentSql(alias: string): SQL {
  const r = sql.raw(alias);
  return sql`(not ${r}.never_sent and (${r}.body ~ '\\S' or ${r}.photo_url is not null or ${r}.audio_url is not null or jsonb_array_length(${r}.poll_choices) > 0))`;
}

/** The same rule for hand-written SQL, over a `section_replies` row aliased as `alias`. */
export function sectionReplyHasContentSql(alias: string): SQL {
  const r = sql.raw(alias);
  return sql`(not ${r}.never_sent and (${r}.body ~ '\\S' or ${r}.link_url is not null or exists (select 1 from section_media sm_any where sm_any.section_reply_id = ${r}.id)))`;
}

/** How many people have written something in the round `issueAlias.id`, for hand-written SQL. */
export function answeredCountSql(issueAlias: string): SQL<number> {
  const i = sql.raw(issueAlias);
  return sql<number>`(select count(*)::int from (
    select r.membership_id from replies r where r.issue_id = ${i}.id and ${replyHasContentSql("r")}
    union
    select sr.membership_id from section_replies sr where sr.issue_id = ${i}.id and ${sectionReplyHasContentSql("sr")}
  ) as answered_people)`.mapWith(Number);
}

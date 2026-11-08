import { and, eq, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { replies, replyMedia } from "../db/schema.ts";

/*
 * What someone has written is in. A saved answer that isn't empty goes out with
 * the round and counts everywhere an answer counts: delivery, the round's page,
 * progress, reminders, the album and exports. An answer cleared back to nothing
 * isn't one. These are the only definitions; nothing reads `status` any more.
 *
 * One rule for every format: text with something other than spaces in it, a
 * photo, a voice note, a poll pick, a music link or a photo-wall photo.
 *
 * `never_sent` marks drafts left behind in rounds that went out before answers
 * saved themselves into the round. They were never part of it and never will be.
 */

/** An answer can be text, a photo, a voice note, a poll pick, a music link, wall photos, or any mix of them. */
export function replyHasContentCondition(): SQL {
  const content = or(
    sql`${replies.body} ~ '\\S'`,
    isNotNull(replies.photoUrl),
    isNotNull(replies.audioUrl),
    sql`jsonb_array_length(${replies.pollChoices}) > 0`,
    isNotNull(replies.linkUrl),
    sql`exists (select 1 from ${replyMedia} where ${replyMedia.replyId} = ${replies.id})`,
  );
  const condition = and(eq(replies.neverSent, false), content);
  if (!condition) throw new Error("Reply content condition is empty.");
  return condition;
}

/** The same rule for hand-written SQL, over a `replies` row aliased as `alias`. */
export function replyHasContentSql(alias: string): SQL {
  const r = sql.raw(alias);
  return sql`(not ${r}.never_sent and (${r}.body ~ '\\S' or ${r}.photo_url is not null or ${r}.audio_url is not null or jsonb_array_length(${r}.poll_choices) > 0 or ${r}.link_url is not null or exists (select 1 from reply_media rm_any where rm_any.reply_id = ${r}.id)))`;
}

/** How many people have written something in the round `issueAlias.id`, for hand-written SQL. */
export function answeredCountSql(issueAlias: string): SQL<number> {
  const i = sql.raw(issueAlias);
  return sql<number>`(select count(distinct r.membership_id)::int from replies r
    where r.issue_id = ${i}.id and ${replyHasContentSql("r")})`.mapWith(Number);
}

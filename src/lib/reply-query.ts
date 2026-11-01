import { isNotNull, or, sql, type SQL } from "drizzle-orm";
import { replies } from "../db/schema.ts";

/** An answer can be text, a photo, a poll pick, or any mix of them. */
export function replyHasContentCondition(): SQL {
  const condition = or(
    sql`${replies.body} <> ''`,
    isNotNull(replies.photoUrl),
    sql`jsonb_array_length(${replies.pollChoices}) > 0`,
  );
  if (!condition) throw new Error("Reply content condition is empty.");
  return condition;
}

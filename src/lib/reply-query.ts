import { isNotNull, or, sql, type SQL } from "drizzle-orm";
import { replies } from "../db/schema.ts";

/** An answer can be text, a photo, or both. */
export function replyHasContentCondition(): SQL {
  const condition = or(sql`${replies.body} <> ''`, isNotNull(replies.photoUrl));
  if (!condition) throw new Error("Reply content condition is empty.");
  return condition;
}

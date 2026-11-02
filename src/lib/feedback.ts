import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { feedback } from "@/db/schema";
import { membershipFromReplyToken } from "./auth";
import { getNow } from "./clock";
import { copy } from "./copy.ts";
import { redactPath } from "./feedback-path";

export const FEEDBACK_MAX_LENGTH = 2000;

/** Per sender per hour. Strangers share one bucket, so theirs is wider. */
export const FEEDBACK_HOURLY_LIMIT = 10;
export const FEEDBACK_HOURLY_LIMIT_ANONYMOUS = 30;

export type FeedbackWriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 429; error: string };

export type FeedbackInput = {
  message: string;
  /** Where they were, as the browser reports it. Reduced to a bare path before storing. */
  path: string;
  userAgent: string;
  viewport: string;
};

/** Someone the request proved, by session. A reply link is proved from the path itself. */
export type FeedbackSession = { id: string; name: string | null; email: string } | null;

const REPLY_PATH = /^\/r\/([^/]+)/;

function clip(value: string, max: number): string | null {
  const trimmed = value.trim().slice(0, max);
  return trimmed || null;
}

/**
 * Store a note from the corner button. Open to anyone: a visitor with no
 * account can still report that the page is broken. A session or a reply link
 * only adds a name, so nobody is ever asked to type who they are.
 */
export async function submitFeedback(
  input: FeedbackInput,
  session: FeedbackSession,
): Promise<FeedbackWriteResult> {
  const message = input.message.trim();
  if (!message || message.length > FEEDBACK_MAX_LENGTH) {
    return { ok: false, status: 400, error: copy.feedback.errors.message };
  }

  const token = REPLY_PATH.exec(input.path.split("?")[0])?.[1];
  const found = token ? await membershipFromReplyToken(decodeURIComponent(token)) : null;
  const sender = found
    ? { userId: found.membership.userId, membershipId: found.membership.id, name: found.membership.name, email: found.membership.email }
    : session
      ? { userId: session.id, membershipId: null, name: session.name, email: session.email }
      : null;

  const at = await getNow();
  const since = new Date(at.getTime() - 60 * 60 * 1000);
  const same = sender?.membershipId
    ? eq(feedback.membershipId, sender.membershipId)
    : sender?.userId
      ? eq(feedback.userId, sender.userId)
      : and(isNull(feedback.userId), isNull(feedback.membershipId));
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(feedback)
    .where(and(same, gt(feedback.createdAt, since)));
  if (count >= (sender ? FEEDBACK_HOURLY_LIMIT : FEEDBACK_HOURLY_LIMIT_ANONYMOUS)) {
    return { ok: false, status: 429, error: copy.feedback.errors.tooMany };
  }

  await db.insert(feedback).values({
    message,
    path: redactPath(input.path),
    userId: sender?.userId ?? null,
    membershipId: sender?.membershipId ?? null,
    senderName: sender?.name ?? null,
    senderEmail: sender?.email ?? null,
    userAgent: clip(input.userAgent, 300),
    viewport: clip(input.viewport, 40),
    createdAt: at,
  });
  return { ok: true };
}

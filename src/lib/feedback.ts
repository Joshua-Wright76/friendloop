import { db } from "@/db";
import { feedback } from "@/db/schema";
import { membershipFromReplyToken } from "./auth";
import { getNow } from "./clock";
import { copy } from "./copy.ts";
import { redactPath } from "./feedback-path";
import { consume, LIMITS } from "./rate-limit";

export const FEEDBACK_MAX_LENGTH = 2000;

/** Per sender per hour. Strangers are counted per network, so theirs is wider. */
export const FEEDBACK_HOURLY_LIMIT = LIMITS.feedback.max;
export const FEEDBACK_HOURLY_LIMIT_ANONYMOUS = LIMITS.feedbackAnonymous.max;

export type FeedbackWriteResult =
  | { ok: true }
  | { ok: false; status: 400 | 429; error: string };

export type FeedbackInput = {
  message: string;
  /** Where they were, as the browser reports it. Reduced to a bare path before storing. */
  path: string;
  userAgent: string;
  viewport: string;
  /** The caller's network, used only to count a stranger's notes. Never stored. */
  ip?: string;
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
  const [key, limit] = sender?.membershipId
    ? [`feedback:member:${sender.membershipId}`, LIMITS.feedback]
    : sender?.userId
      ? [`feedback:user:${sender.userId}`, LIMITS.feedback]
      : [`feedback:ip:${input.ip ?? "unknown"}`, LIMITS.feedbackAnonymous];
  if (!(await consume(key, limit, at)).allowed) {
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

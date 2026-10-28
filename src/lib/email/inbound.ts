import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { Resend, type WebhookEventPayload } from "resend";
import { db } from "@/db";
import { comments, memberships, outbox } from "@/db/schema";
import { commentFromEmail } from "./inbound-text";
import { normalizeEmailAddress, replyTokenFromRecipients } from "./reply-address";

export const MAX_INBOUND_COMMENT_LENGTH = 2000;

export type EmailReceivedEvent = Extract<WebhookEventPayload, { type: "email.received" }>;
export type ReceivedEmailContent = {
  from: string;
  text: string | null;
  html: string | null;
};
export type InboundResult = {
  status: number;
  body: Record<string, string | boolean>;
};
type LoadReceivedEmail = (emailId: string) => Promise<ReceivedEmailContent>;

function resend(): Resend {
  return new Resend(process.env.RESEND_API_KEY ?? "");
}

async function loadFromResend(emailId: string): Promise<ReceivedEmailContent> {
  const { data, error } = await resend().emails.receiving.get(emailId);
  if (error || !data) throw new Error(error?.message ?? "Received email not found");
  return { from: data.from, text: data.text, html: data.html };
}

function ignored(reason: string): InboundResult {
  return { status: 200, body: { ok: true, ignored: reason } };
}

export async function processInboundEmail(
  event: EmailReceivedEvent,
  loadEmail: LoadReceivedEmail = loadFromResend,
): Promise<InboundResult> {
  const token = replyTokenFromRecipients(event.data.to);
  if (!token) return ignored("recipient");

  const [delivery] = await db
    .select({
      issueId: outbox.issueId,
      membershipId: memberships.id,
      membershipEmail: memberships.email,
      revokedAt: memberships.revokedAt,
    })
    .from(outbox)
    .innerJoin(memberships, eq(memberships.id, outbox.membershipId))
    .where(and(eq(outbox.replyToken, token), eq(outbox.kind, "delivery")))
    .limit(1);

  if (!delivery?.issueId || delivery.revokedAt) return ignored("membership");

  const [existing] = await db
    .select({ id: comments.id })
    .from(comments)
    .where(eq(comments.inboundEmailId, event.data.email_id))
    .limit(1);
  if (existing) return { status: 200, body: { ok: true, deduped: true } };

  const sender = normalizeEmailAddress(event.data.from);
  if (sender !== normalizeEmailAddress(delivery.membershipEmail)) return ignored("sender");

  let email: ReceivedEmailContent;
  try {
    email = await loadEmail(event.data.email_id);
  } catch {
    return { status: 502, body: { ok: false, error: "Could not retrieve the received email" } };
  }

  if (normalizeEmailAddress(email.from) !== sender) return ignored("sender");

  const body = commentFromEmail(email);
  if (!body) return ignored("empty");
  if (body.length > MAX_INBOUND_COMMENT_LENGTH) return ignored("too-long");

  const inserted = await db
    .insert(comments)
    .values({
      issueId: delivery.issueId,
      membershipId: delivery.membershipId,
      body,
      inboundEmailId: event.data.email_id,
    })
    .onConflictDoNothing({ target: comments.inboundEmailId })
    .returning({ id: comments.id });

  if (inserted.length === 0) return { status: 200, body: { ok: true, deduped: true } };

  revalidatePath(`/i/${delivery.issueId}`);
  return { status: 200, body: { ok: true, commented: true } };
}

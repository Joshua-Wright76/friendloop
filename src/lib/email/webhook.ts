import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { emailEvents, emailSuppressions, outbox } from "@/db/schema";
import { safeEqual } from "../tokens.ts";

/** Svix's own default: a signed request older or newer than this is a replay. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

/**
 * Verify a Resend webhook the way Svix signs it, with node:crypto only.
 *
 * The signed content is `${svix-id}.${svix-timestamp}.${raw body}`, HMAC-SHA256
 * keyed with the base64 part of the `whsec_…` secret. `svix-signature` is a
 * space-separated list of `v1,<base64>` entries (several during a key rotation);
 * any one match is enough. The timestamp bounds replays: a captured request
 * stops verifying after five minutes, and the `svix-id` is stored uniquely, so
 * one replayed inside that window is recorded once.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  body: string;
  now: Date;
  toleranceSeconds?: number;
}): SignatureCheck {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature || !input.secret) return { ok: false, reason: "missing" };

  const seconds = Number(timestamp);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (!/^\d+$/.test(timestamp) || Math.abs(input.now.getTime() / 1000 - seconds) > tolerance) {
    return { ok: false, reason: "stale" };
  }

  const key = Buffer.from(input.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${input.body}`).digest("base64");

  const matches = signature
    .split(" ")
    .map((entry) => entry.split(","))
    .some(([version, value]) => version === "v1" && value !== undefined && safeEqual(value, expected));
  return matches ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** The slice of a Resend event payload this app reads. */
export type ResendEvent = {
  type?: unknown;
  data?: {
    email_id?: unknown;
    to?: unknown;
    bounce?: { type?: unknown } | null;
  } | null;
};

/**
 * What a provider event means for future mail: a hard bounce or a complaint
 * stops loop mail to that address. A soft bounce (`Transient`) is the provider
 * still trying, so it suppresses nothing. Resend only raises `email.bounced` for
 * permanent failures; an event without a bounce type is treated as one.
 */
export function suppressionReasonOf(event: ResendEvent): "bounce" | "complaint" | null {
  if (event.type === "email.complained") return "complaint";
  if (event.type === "email.bounced") {
    const kind = event.data?.bounce?.type;
    return kind === undefined || kind === null || kind === "Permanent" ? "bounce" : null;
  }
  return null;
}

function recipientsOf(event: ResendEvent): string[] {
  const to = event.data?.to;
  const list = Array.isArray(to) ? to : typeof to === "string" ? [to] : [];
  return list.filter((value): value is string => typeof value === "string").map((value) => value.trim().toLowerCase());
}

export type RecordResult = { recorded: boolean; suppressed: string[] };

/**
 * Store one verified event in `email_events`, linked to the outbox row Resend
 * returned this id for, and suppress the address on a hard bounce or complaint.
 * A redelivered event (same `svix-id`) changes nothing.
 */
export async function recordResendEvent(input: { messageId: string; event: ResendEvent }): Promise<RecordResult> {
  const { event } = input;
  const providerId = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  const type = typeof event.type === "string" ? event.type : "unknown";

  const [row] = providerId
    ? await db.select({ id: outbox.id, to: outbox.to }).from(outbox).where(eq(outbox.providerId, providerId)).limit(1)
    : [];

  const inserted = await db
    .insert(emailEvents)
    .values({
      providerId,
      type,
      payload: event,
      messageId: input.messageId,
      outboxId: row?.id ?? null,
    })
    .onConflictDoNothing({ target: emailEvents.messageId })
    .returning({ id: emailEvents.id });
  if (inserted.length === 0) return { recorded: false, suppressed: [] };

  const reason = suppressionReasonOf(event);
  if (!reason) return { recorded: true, suppressed: [] };

  // The payload names the recipient; the outbox row is the fallback for a
  // payload that does not.
  const recipients = recipientsOf(event);
  const addresses = recipients.length > 0 ? recipients : row ? [row.to.trim().toLowerCase()] : [];
  for (const email of addresses) {
    // A complaint outranks a bounce: it is the person themselves saying stop.
    await db
      .insert(emailSuppressions)
      .values({ email, reason, providerId: providerId || null })
      .onConflictDoUpdate({
        target: emailSuppressions.email,
        set: reason === "complaint" ? { reason, providerId: providerId || null } : { providerId: providerId || null },
      });
  }
  return { recorded: true, suppressed: addresses };
}

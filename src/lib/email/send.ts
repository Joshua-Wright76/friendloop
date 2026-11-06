import { Resend } from "resend";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppressions, memberships, outbox } from "@/db/schema";
import type { RenderedEmail } from "./templates";
import { copy } from "../copy.ts";
import { e2eSeamsAllowed } from "../e2e.ts";
import { oneClickUnsubscribeUrl } from "../urls.ts";

export type EmailKind = (typeof outbox.$inferInsert)["kind"];

export type QueueInput = RenderedEmail & {
  to: string;
  kind: EmailKind;
  /** Stable identity for this send, e.g. `prompt:${issueId}:${membershipId}`. */
  dedupeKey: string;
  groupId?: string | null;
  issueId?: string | null;
  membershipId?: string | null;
  /** Overrides the sender display name, e.g. the loop's name. */
  fromName?: string | null;
  /**
   * The recipient membership's unsubscribe token. Every loop email carries one,
   * which adds `List-Unsubscribe` and `List-Unsubscribe-Post` (RFC 8058).
   */
  unsubscribeToken?: string | null;
};

/** Kinds that are never held back: someone asked for this exact email just now. */
const TRANSACTIONAL: ReadonlySet<EmailKind> = new Set(["signin"]);

export type SuppressedReason = "muted" | "bounce" | "complaint";

/** RFC 2369 + RFC 8058 headers for one membership's unsubscribe token. */
export function listUnsubscribeHeaders(token: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUnsubscribeUrl(token)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Whether this email must be recorded but not sent. Sign-in links always go. A
 * loop email is held back when its membership is muted, or when the provider has
 * reported the address as a hard bounce or a spam complaint.
 */
export async function suppressionFor(input: {
  to: string;
  kind: EmailKind;
  membershipId?: string | null;
}): Promise<SuppressedReason | null> {
  if (TRANSACTIONAL.has(input.kind)) return null;
  if (input.membershipId) {
    const [membership] = await db
      .select({ mutedAt: memberships.mutedAt })
      .from(memberships)
      .where(eq(memberships.id, input.membershipId))
      .limit(1);
    if (membership?.mutedAt) return "muted";
  }
  const [suppressed] = await db
    .select({ reason: emailSuppressions.reason })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, input.to.trim().toLowerCase()))
    .limit(1);
  return suppressed?.reason ?? null;
}

export type Transport = "outbox" | "resend";

/** Header a test uses to force one request down the real provider path. */
export const TRANSPORT_HEADER = "x-e2e-email-transport";

/** `outbox` skips the provider entirely (tests, and local dev without a key). */
function configuredTransport(): Transport {
  if (process.env.EMAIL_TRANSPORT === "outbox") return "outbox";
  if (process.env.EMAIL_TRANSPORT === "resend") return "resend";
  return process.env.RESEND_API_KEY ? "resend" : "outbox";
}

/** True when emails are only recorded, never handed to a provider. */
export function emailIsCaptured(): boolean {
  return configuredTransport() === "outbox";
}

/**
 * The transport for this request.
 *
 * With `E2E=1` a test may override the configured transport for a single request
 * with `x-e2e-email-transport`, the same way `x-e2e-now` moves the clock. Without
 * that, the provider path — the one production actually runs — could only be
 * exercised by pointing a whole test run at a real Resend key.
 */
async function transport(): Promise<Transport> {
  if (e2eSeamsAllowed()) {
    try {
      const { headers } = await import("next/headers");
      const override = (await headers()).get(TRANSPORT_HEADER);
      if (override === "outbox" || override === "resend") return override;
    } catch {
      // Outside a request scope (scripts, sweep in a unit test) — fall through.
    }
  }
  return configuredTransport();
}

function addressBook(fromName?: string | null): string {
  const configured = process.env.EMAIL_FROM ?? `${copy.common.brand} <hello@friendloop.dev>`;
  if (!fromName) return configured;
  const address = configured.match(/<([^>]+)>/)?.[1] ?? configured;
  return `${fromName} <${address}>`;
}

let resendClient: Resend | null = null;
function resend(): Resend {
  if (!resendClient) {
    // `RESEND_BASE_URL` is what lets the suite run the real SDK against a stub
    // that can reject, rate-limit, or fail — the paths no outbox-only test sees.
    resendClient = new Resend(process.env.RESEND_API_KEY ?? "", {
      baseUrl: process.env.RESEND_BASE_URL || undefined,
    });
  }
  return resendClient;
}

/**
 * Write the email to the outbox before anything leaves the building.
 *
 * The row is the record of intent: `dedupe_key` is unique, so a retried cron run,
 * a redeploy mid-send, or a double click can never produce two emails.
 */
export async function queueEmail(
  input: QueueInput,
): Promise<{ id: string | null; deduped: boolean; suppressed: SuppressedReason | null }> {
  const suppressed = await suppressionFor(input);
  const inserted = await db
    .insert(outbox)
    .values({
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      kind: input.kind,
      dedupeKey: input.dedupeKey,
      groupId: input.groupId ?? null,
      issueId: input.issueId ?? null,
      membershipId: input.membershipId ?? null,
      headers: input.unsubscribeToken ? listUnsubscribeHeaders(input.unsubscribeToken) : null,
      ...(suppressed ? { status: "suppressed" as const, suppressedReason: suppressed } : {}),
    })
    .onConflictDoNothing({ target: outbox.dedupeKey })
    .returning({ id: outbox.id });

  if (inserted.length > 0) return { id: inserted[0].id, deduped: false, suppressed };

  const existing = await db
    .select({ id: outbox.id })
    .from(outbox)
    .where(eq(outbox.dedupeKey, input.dedupeKey))
    .limit(1);
  return { id: existing[0]?.id ?? null, deduped: true, suppressed: null };
}

async function dispatch(row: {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string | null;
  headers?: Record<string, string> | null;
}): Promise<void> {
  if ((await transport()) === "outbox") {
    await db
      .update(outbox)
      .set({ status: "sent", sentAt: new Date(), providerId: `outbox_${row.id}` })
      .where(eq(outbox.id, row.id));
    return;
  }

  try {
    const { data, error } = await resend().emails.send({
      from: addressBook(row.fromName),
      to: [row.to],
      subject: row.subject,
      html: row.html,
      text: row.text,
      ...(row.headers ? { headers: row.headers } : {}),
    });
    if (error) throw new Error(error.message ?? "resend rejected the message");
    await db
      .update(outbox)
      .set({ status: "sent", sentAt: new Date(), providerId: data?.id ?? null, error: null })
      .where(eq(outbox.id, row.id));
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await db
      .update(outbox)
      .set({ status: "failed", error: message, attempts: sql`${outbox.attempts} + 1` })
      .where(eq(outbox.id, row.id));
  }
}

/**
 * Queue then attempt delivery. Never throws on provider trouble — a failed send
 * stays `failed` in the outbox and the next sweep retries it.
 */
export async function sendEmail(input: QueueInput): Promise<{ queued: boolean; emailId: string | null }> {
  const { id, deduped, suppressed } = await queueEmail(input);
  if (deduped || !id || suppressed) return { queued: false, emailId: id };
  await dispatch({
    ...input,
    id,
    fromName: input.fromName,
    headers: input.unsubscribeToken ? listUnsubscribeHeaders(input.unsubscribeToken) : null,
  });
  return { queued: true, emailId: id };
}

/** Retry anything the provider rejected. Called by the sweep. */
/**
 * About a day of 15-minute sweeps. Long enough to outlast a provider outage, and
 * after that a row stays `failed` with its reason rather than retrying for ever.
 */
export const MAX_SEND_ATTEMPTS = 96;

export async function flushOutbox(limit = 25): Promise<number> {
  const pending = await db
    .select({
      id: outbox.id,
      to: outbox.to,
      subject: outbox.subject,
      html: outbox.html,
      text: outbox.text,
      headers: outbox.headers,
      kind: outbox.kind,
      membershipId: outbox.membershipId,
    })
    .from(outbox)
    .where(and(inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, MAX_SEND_ATTEMPTS)))
    // Fewest tries first, so a batch of stubborn rejections can't hold up newer mail.
    .orderBy(asc(outbox.attempts), asc(outbox.createdAt))
    .limit(limit);

  for (const row of pending) {
    // A retry asks again: the member may have muted, or the address bounced,
    // since the first attempt failed.
    const suppressed = await suppressionFor(row);
    if (suppressed) {
      await db
        .update(outbox)
        .set({ status: "suppressed", suppressedReason: suppressed })
        .where(eq(outbox.id, row.id));
      continue;
    }
    await dispatch(row);
  }
  return pending.length;
}

/** Test and probe helper: the newest email for a dedupe prefix. */
export async function latestOutboxRow(prefix: string) {
  const rows = await db
    .select()
    .from(outbox)
    .where(and(sql`${outbox.dedupeKey} like ${`${prefix}%`}`))
    .orderBy(sql`${outbox.createdAt} desc`)
    .limit(1);
  return rows[0] ?? null;
}

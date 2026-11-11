import { Resend } from "resend";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppressions, memberships, outbox } from "@/db/schema";
import { budgetAlertEmail, type RenderedEmail } from "./templates.ts";
import { copy } from "../copy.ts";
import { e2eSeamsAllowed } from "../e2e.ts";
import { log } from "../log.ts";
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
const TRANSACTIONAL: ReadonlySet<EmailKind> = new Set(["signin", "email_change", "alert"]);

export type SuppressedReason = "muted" | "bounce" | "complaint";

/** Resend's free tier. Set `EMAIL_DAILY_BUDGET` to match a bigger plan. */
const DEFAULT_DAILY_BUDGET = 100;
/** Kept back for sign-in links, which are useless if they arrive late. */
const SIGN_IN_RESERVE = 20;

export function dailySendBudget(): number {
  const configured = Number(process.env.EMAIL_DAILY_BUDGET);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_DAILY_BUDGET;
}

export async function sentInLastDay(): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.status, "sent"), gt(outbox.sentAt, since)));
  return count;
}

/** How much of the day's budget loop mail may use: all of it but the sign-in reserve. */
export function loopMailAllowance(): number {
  return Math.max(0, dailySendBudget() - SIGN_IN_RESERVE);
}

/** Loop mail this far into its allowance earns a heads-up, while there is still room. */
export const BUDGET_WARNING_SHARE = 0.75;

/**
 * Tell whoever runs this instance (`FEEDBACK_NOTIFY_EMAIL`) that the day's email
 * is running low, or has run out and loop mail is waiting. Once per level per
 * UTC day: the dedupe key makes every later call a no-op. An alert is never held
 * back itself, or the one about running out could never arrive.
 */
async function alertBudget(level: "near" | "reached", used: number): Promise<void> {
  const to = process.env.FEEDBACK_NOTIFY_EMAIL?.trim();
  if (!to) return;
  const day = new Date().toISOString().slice(0, 10);
  // Like any send, a provider failure is recorded rather than thrown.
  await sendEmail({
    ...budgetAlertEmail({ level, used, allowance: loopMailAllowance(), budget: dailySendBudget() }),
    to,
    kind: "alert",
    dedupeKey: `alert:budget-${level}:${day}`,
  });
}

/**
 * Whether loop mail has to wait for tomorrow's quota right now. Loop mail stops
 * short of the provider's limit so a sign-in link can still go out. A held row
 * stays `pending` with no attempt counted, and the sweep sends it once there is room.
 */
export async function loopMailHeld(): Promise<boolean> {
  return (await sentInLastDay()) >= loopMailAllowance();
}

/** This loop's emails waiting on the daily budget: none unless the budget is spent. */
export async function heldMailFor(groupId: string): Promise<number> {
  if ((await transport()) === "outbox" || !(await loopMailHeld())) return 0;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.groupId, groupId), eq(outbox.status, "pending")));
  return count;
}

/** The loop owner's address, for the replies people will send anyway. */
async function ownerAddress(groupId: string): Promise<string | null> {
  const [owner] = await db
    .select({ email: memberships.email })
    .from(memberships)
    .where(and(eq(memberships.groupId, groupId), eq(memberships.access, "owner")))
    .limit(1);
  return owner?.email ?? null;
}

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

/**
 * What an outbox row's html and text become once the provider has the email.
 * The body is kept only while it may still need sending. A captured outbox
 * (tests, local dev) keeps it, since nothing left and it is the only copy.
 */
export const SENT_BODY = "";

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
  const replyTo = input.groupId ? await ownerAddress(input.groupId) : null;
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
      fromName: input.fromName ?? null,
      replyTo,
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
  kind: EmailKind;
  fromName?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string> | null;
}): Promise<"sent" | "failed" | "held"> {
  if ((await transport()) === "outbox") {
    await db
      .update(outbox)
      .set({ status: "sent", sentAt: new Date(), providerId: `outbox_${row.id}` })
      .where(eq(outbox.id, row.id));
    return "sent";
  }

  // Counted before the send, so loop mail can be held and the warning can fire after it.
  const used = TRANSACTIONAL.has(row.kind) ? null : await sentInLastDay();
  if (used !== null && used >= loopMailAllowance()) {
    await alertBudget("reached", used);
    return "held";
  }

  try {
    const { data, error } = await resend().emails.send({
      from: addressBook(row.fromName),
      to: [row.to],
      subject: row.subject,
      html: row.html,
      text: row.text,
      ...(row.replyTo ? { replyTo: row.replyTo } : {}),
      ...(row.headers ? { headers: row.headers } : {}),
    });
    if (error) throw new Error(error.message ?? "resend rejected the message");
    // Once it has left, the body is someone's private loop, so only the envelope stays.
    await db
      .update(outbox)
      .set({ status: "sent", sentAt: new Date(), providerId: data?.id ?? null, error: null, html: SENT_BODY, text: SENT_BODY })
      .where(eq(outbox.id, row.id));
    if (used !== null && used + 1 >= Math.ceil(loopMailAllowance() * BUDGET_WARNING_SHARE)) {
      await alertBudget("near", used + 1);
    }
    return "sent";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    await db
      .update(outbox)
      .set({ status: "failed", error: message, attempts: sql`${outbox.attempts} + 1` })
      .where(eq(outbox.id, row.id));
    return "failed";
  }
}

/**
 * Queue then attempt delivery. Never throws on provider trouble — a failed send
 * stays `failed` in the outbox and the next sweep retries it.
 */
export async function sendEmail(input: QueueInput): Promise<{ queued: boolean; emailId: string | null }> {
  const { id, deduped, suppressed } = await queueEmail(input);
  if (deduped || !id || suppressed) return { queued: false, emailId: id };
  const [stored] = await db.select({ replyTo: outbox.replyTo }).from(outbox).where(eq(outbox.id, id)).limit(1);
  await dispatch({
    ...input,
    id,
    fromName: input.fromName,
    replyTo: stored?.replyTo ?? null,
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
      fromName: outbox.fromName,
      replyTo: outbox.replyTo,
      kind: outbox.kind,
      membershipId: outbox.membershipId,
    })
    .from(outbox)
    .where(and(inArray(outbox.status, ["pending", "failed"]), lt(outbox.attempts, MAX_SEND_ATTEMPTS)))
    // Fewest tries first, so a batch of stubborn rejections can't hold up newer mail.
    .orderBy(asc(outbox.attempts), asc(outbox.createdAt))
    .limit(limit);

  let held = 0;
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
    if ((await dispatch(row)) === "held") held += 1;
  }
  // Once per sweep rather than once per email: this is worth a look, not a flood.
  if (held > 0) log.error("Daily email budget reached, so loop mail is waiting", undefined, { held, budget: dailySendBudget() });
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

import { Resend } from "resend";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { outbox } from "@/db/schema";
import type { RenderedEmail } from "./templates";
import { copy } from "../copy.ts";
import { newToken } from "../tokens.ts";
import { replyAddress } from "./reply-address.ts";

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
};

/** True when emails are only recorded, never handed to a provider. */
export function emailIsCaptured(): boolean {
  return transport() === "outbox";
}

/** `outbox` skips the provider entirely (tests, and local dev without a key). */
function transport(): "outbox" | "resend" {
  if (process.env.EMAIL_TRANSPORT === "outbox") return "outbox";
  if (process.env.EMAIL_TRANSPORT === "resend") return "resend";
  return process.env.RESEND_API_KEY ? "resend" : "outbox";
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
    resendClient = new Resend(process.env.RESEND_API_KEY ?? "");
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
): Promise<{ id: string | null; deduped: boolean; replyToken: string | null }> {
  const replyToken = input.kind === "delivery" ? newToken() : null;
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
      replyToken,
    })
    .onConflictDoNothing({ target: outbox.dedupeKey })
    .returning({ id: outbox.id, replyToken: outbox.replyToken });

  if (inserted.length > 0) return { id: inserted[0].id, deduped: false, replyToken: inserted[0].replyToken };

  const existing = await db
    .select({ id: outbox.id, replyToken: outbox.replyToken })
    .from(outbox)
    .where(eq(outbox.dedupeKey, input.dedupeKey))
    .limit(1);
  return { id: existing[0]?.id ?? null, deduped: true, replyToken: existing[0]?.replyToken ?? null };
}

async function dispatch(row: {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  kind: EmailKind;
  replyToken: string | null;
  fromName?: string | null;
}): Promise<void> {
  if (transport() === "outbox") {
    await db
      .update(outbox)
      .set({ status: "sent", sentAt: new Date(), providerId: `outbox_${row.id}` })
      .where(eq(outbox.id, row.id));
    return;
  }

  const replyTo = row.kind === "delivery" && row.replyToken ? replyAddress(row.replyToken) : null;

  try {
    const { data, error } = await resend().emails.send({
      from: addressBook(row.fromName),
      to: [row.to],
      subject: row.subject,
      html: row.html,
      text: row.text,
      ...(replyTo ? { replyTo } : {}),
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
  const { id, deduped, replyToken } = await queueEmail(input);
  if (deduped || !id) return { queued: false, emailId: id };
  await dispatch({ ...input, id, replyToken, fromName: input.fromName });
  return { queued: true, emailId: id };
}

/** Retry anything the provider rejected. Called by the sweep. */
export async function flushOutbox(limit = 25): Promise<number> {
  const pending = await db
    .select({
      id: outbox.id,
      to: outbox.to,
      subject: outbox.subject,
      html: outbox.html,
      text: outbox.text,
      kind: outbox.kind,
      replyToken: outbox.replyToken,
    })
    .from(outbox)
    .where(inArray(outbox.status, ["pending", "failed"]))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);

  for (const row of pending) {
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

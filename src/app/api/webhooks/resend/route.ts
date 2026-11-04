import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { recordResendEvent, verifyWebhookSignature, type ResendEvent } from "@/lib/email/webhook";

/**
 * Resend's delivery events (Resend → Webhooks → this URL). Signed with Svix;
 * nothing is read from the body until the signature over the raw bytes checks
 * out. Without `RESEND_WEBHOOK_SECRET` the endpoint refuses everything rather
 * than trusting unsigned input.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });

  const body = await request.text();
  const check = verifyWebhookSignature({
    secret,
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
    body,
    now: await getNow(),
  });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 401 });

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!event || typeof event !== "object") {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  const result = await recordResendEvent({ messageId: request.headers.get("svix-id")!, event });
  return NextResponse.json({ ok: true, duplicate: !result.recorded });
}

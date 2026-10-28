import { Resend } from "resend";
import { processInboundEmail, type ReceivedEmailContent } from "@/lib/email/inbound";

export async function POST(request: Request): Promise<Response> {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.RESEND_API_KEY;
  if (!webhookSecret || !apiKey) {
    return Response.json({ ok: false, error: "Inbound email is not configured" }, { status: 503 });
  }

  const payload = await request.text();
  const client = new Resend(apiKey);
  let event;
  try {
    event = client.webhooks.verify({
      payload,
      headers: {
        id: request.headers.get("webhook-id") ?? "",
        timestamp: request.headers.get("webhook-timestamp") ?? "",
        signature: request.headers.get("webhook-signature") ?? "",
      },
      webhookSecret,
    });
  } catch {
    return Response.json({ ok: false, error: "Invalid webhook signature" }, { status: 401 });
  }

  if (event.type !== "email.received") {
    return Response.json({ ok: true, ignored: "event" });
  }

  const testText = request.headers.get("x-e2e-inbound-text");
  const testHtml = request.headers.get("x-e2e-inbound-html");
  const loadTestEmail =
    process.env.E2E === "1" && (testText !== null || testHtml !== null)
      ? async (): Promise<ReceivedEmailContent> => ({
          from: event.data.from,
          text: testText === null ? null : Buffer.from(testText, "base64").toString("utf8"),
          html: testHtml === null ? null : Buffer.from(testHtml, "base64").toString("utf8"),
        })
      : undefined;

  const result = await processInboundEmail(event, loadTestEmail);
  return Response.json(result.body, { status: result.status });
}

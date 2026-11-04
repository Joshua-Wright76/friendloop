import { createHmac } from "node:crypto";
import { APP } from "./harness";

/** The secret the e2e server is started with (see playwright.config.ts). */
export const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? "whsec_ZTJlLXJlc2VuZC13ZWJob29rLXNlY3JldA==";

/** Sign a body exactly as Svix does for Resend: HMAC-SHA256 over `id.timestamp.body`. */
export function svixHeaders(body: string, input: { id: string; at?: Date; secret?: string }): Record<string, string> {
  const timestamp = String(Math.floor((input.at ?? new Date()).getTime() / 1000));
  const key = Buffer.from((input.secret ?? WEBHOOK_SECRET).replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${input.id}.${timestamp}.${body}`).digest("base64");
  return {
    "content-type": "application/json",
    "svix-id": input.id,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${signature}`,
  };
}

/** POST one signed Resend event to the app, the way Resend would. */
export async function postResendEvent(event: unknown, input: { id: string; at?: Date; secret?: string; clock?: Date }) {
  const body = JSON.stringify(event);
  return fetch(`${APP}/api/webhooks/resend`, {
    method: "POST",
    headers: { ...svixHeaders(body, input), ...(input.clock ? { "x-e2e-now": input.clock.toISOString() } : {}) },
    body,
  });
}

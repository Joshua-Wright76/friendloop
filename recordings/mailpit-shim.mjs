#!/usr/bin/env node
import { createServer } from "node:http";

/**
 * Resend-shaped → Mailpit adapter for local development.
 *
 * The app sends email through the Resend HTTP API (`POST {baseUrl}/emails`,
 * src/lib/email/send.ts, dispatched by the real `resend` SDK). Running the
 * provider path locally requires a server that speaks that shape. Mailpit
 * doesn't, so this translates: requests arrive as Resend and leave as
 * Mailpit's send API (`POST http://127.0.0.1:8025/api/v1/send`), which stores
 * the message for the UI at http://127.0.0.1:8025.
 *
 * Before it forwards, the outbox already holds the record of intent — this
 * shim is delivery only; failures here mark the row `failed`, and the next
 * sweep retries.
 *
 * Usage:
 *   node scripts/mailpit-shim.mjs            # listens on 127.0.0.1:3102
 *
 * .env then gets:
 *   RESEND_API_KEY="re_local_anything"       # present → transport is "resend" (send.ts)
 *   RESEND_BASE_URL="http://127.0.0.1:3102"  # SDK talks to this instead of resend.com
 */

const PORT = Number(process.env.MAILPIT_SHIM_PORT ?? 3102);
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";

/** `"Name <addr>"` → `{ Name, Address }` in the shape Mailpit's send API expects. */
function parseAddress(header = "") {
  const name = header.match(/^([^<]*)</)?.[1]?.trim() ?? "";
  const address = header.match(/<([^>]+)>/)?.[1]?.trim() ?? header.trim();
  return { Name: name, Email: address };
}

/** Accept the header as-is when it already carries a display name. */
function addressBook(fromName, fromHeader) {
  if (!fromName) return parseAddress(fromHeader);
  const { Email } = parseAddress(fromHeader);
  return { Name: fromName, Email };
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function forward(payload) {
  const body = {
    From: addressBook(payload.fromName, payload.from),
    To: [].concat(payload.to ?? []).map((to) => parseAddress(to)),
    Subject: payload.subject ?? "",
    HTML: payload.html ?? "",
    Text: payload.text ?? "",
  };
  const response = await fetch(`${MAILPIT_URL}/api/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Mailpit rejected the message (${response.status}): ${detail}`);
  }
  return (await response.json()) ?? {};
}

async function handle(request, response) {
  const { pathname } = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);

  // Health check for the wait loop in bin/dev-memory (and impatience in general).
  if (pathname === "/__healthy" && request.method === "GET") return json(response, 200, { ok: true });

  if (pathname === "/emails" && request.method === "POST") {
    const payload = JSON.parse((await readBody(request)) || "{}");
    const { ID } = await forward(payload);
    return json(response, 200, { id: `mailpit_${ID}` });
  }

  return json(response, 404, { message: "not found" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error("mailpit shim failed", error);
    if (!response.headersSent) json(response, 500, { name: "internal_server_error", message: String(error?.message ?? error) });
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mailpit shim on http://127.0.0.1:${PORT} → ${MAILPIT_URL}`);
});

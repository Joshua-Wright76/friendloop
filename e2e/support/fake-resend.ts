import { createServer, type Server } from "node:http";

/**
 * A Resend-shaped server the suite can make misbehave.
 *
 * The outbox transport never reaches `dispatch()`'s failure path, so that path
 * only exists in production until something exercises it. Pointing the real
 * Resend SDK at a local stub does: the same request shape, the same error
 * mapping, the same `providerId` write — and a failure the test chooses.
 *
 * Control is over HTTP because tests run in worker processes and the stub lives
 * in the runner process.
 */

export const FAKE_MAIL_PORT = Number(process.env.E2E_FAKE_MAIL_PORT ?? 3101);
const STUB_URL = `http://127.0.0.1:${FAKE_MAIL_PORT}`;
/** Each worker's server sends to `/w<n>`, so one test's forced failures can't reach another's mail. */
export const FAKE_MAIL_URL = process.env.TEST_PARALLEL_INDEX === undefined
  ? STUB_URL
  : `${STUB_URL}/w${process.env.TEST_PARALLEL_INDEX}`;

type Sent = { to: string; subject: string; headers?: Record<string, string> };
type State = { failNext: number; failStatus: number; sent: Sent[] };

const mailboxes = new Map<string, State>();
function mailbox(name: string): State {
  let found = mailboxes.get(name);
  if (!found) {
    found = { failNext: 0, failStatus: 500, sent: [] };
    mailboxes.set(name, found);
  }
  return found;
}

/** Addresses that always fail, so a fixture can mean "this person's mail bounces". */
const ALWAYS_FAIL = /rejected@/i;
const THROTTLED = /throttled@/i;

function json(response: import("node:http").ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function handle(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
) {
  const [, name = "", path] = /^(?:\/(w\d+))?(\/.*)$/.exec(new URL(request.url ?? "/", STUB_URL).pathname) ?? [];
  const state = mailbox(name);

  if (path === "/__control" && request.method === "POST") {
    const body = JSON.parse((await readBody(request)) || "{}") as Partial<State>;
    state.failNext = body.failNext ?? 0;
    state.failStatus = body.failStatus ?? 500;
    state.sent = [];
    return json(response, 200, { ok: true, failNext: state.failNext, failStatus: state.failStatus });
  }

  if (path === "/__sent" && request.method === "GET") {
    return json(response, 200, state.sent);
  }

  if (path === "/__shutdown" && request.method === "POST") {
    json(response, 200, { ok: true });
    response.on("finish", () => activeServer?.close());
    return;
  }

  if (path === "/emails" && request.method === "POST") {
    const payload = JSON.parse((await readBody(request)) || "{}") as {
      to?: string | string[];
      subject?: string;
      headers?: Record<string, string>;
    };
    const to = Array.isArray(payload.to) ? (payload.to[0] ?? "") : (payload.to ?? "");
    state.sent.push({ to, subject: payload.subject ?? "", ...(payload.headers ? { headers: payload.headers } : {}) });

    if (THROTTLED.test(to)) {
      return json(response, 429, {
        statusCode: 429,
        name: "rate_limit_exceeded",
        message: "Too many requests. Please try again later.",
      });
    }
    if (ALWAYS_FAIL.test(to)) {
      return json(response, 500, {
        statusCode: 500,
        name: "internal_server_error",
        message: "The mail server rejected the message.",
      });
    }
    if (state.failNext > 0) {
      state.failNext -= 1;
      const rateLimited = state.failStatus === 429;
      return json(response, state.failStatus, rateLimited
        ? {
            statusCode: 429,
            name: "rate_limit_exceeded",
            message: "Too many requests. Please try again later.",
          }
        : {
            statusCode: state.failStatus,
            name: "internal_server_error",
            message: `Provider failure ${state.failStatus}.`,
          });
    }

    return json(response, 200, { id: `fake_${state.sent.length}` });
  }

  return json(response, 404, { message: "not found" });
}

/** Reuse a stub a previous interrupted run left behind instead of failing on EADDRINUSE. */
async function alreadyRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${STUB_URL}/__sent`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function startFakeResend(): Promise<Server | null> {
  if (await alreadyRunning()) return null;

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      console.error("fake resend handler failed", error);
      json(response, 500, { message: "stub failure" });
    });
  });
  activeServer = server;

  await new Promise<void>((resolve) => server.listen(FAKE_MAIL_PORT, "127.0.0.1", resolve));
  return server;
}

let activeServer: Server | null = null;

export async function stopFakeResend(server: Server | null): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/** Teardown runs from the runner process too, but a shutdown over HTTP is ordered. */
export async function stopFakeResendRemotely(): Promise<void> {
  try {
    await fetch(`${STUB_URL}/__shutdown`, { method: "POST" });
  } catch {
    // Already gone: an interrupted run, or a stub this run reused.
  }
}

/** Fail the next `count` sends, whatever the recipient. */
export async function failNextSends(count: number, failStatus = 500): Promise<void> {
  await fetch(`${FAKE_MAIL_URL}/__control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ failNext: count, failStatus }),
  });
}

/** What the provider was actually asked to send, in order. */
export async function providerLog(): Promise<Sent[]> {
  const response = await fetch(`${FAKE_MAIL_URL}/__sent`);
  return (await response.json()) as Sent[];
}

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http, { type OutgoingHttpHeaders } from "node:http";
import http2 from "node:http2";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Production is HTTP/2 behind Vercel's edge; `next start` is HTTP/1.1. Left alone,
 * the browser's six-connection limit punishes every page with many small files far
 * beyond what a real visitor sees, so the lab fronts the app the way production does.
 */
/** Vercel's CDN compresses text it is handed uncompressed; `next start` skips streamed route handlers. */
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/;

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "proxy-connection", "http2-settings"]);

function certificate(directory: string) {
  const key = path.join(directory, "edge.key");
  const cert = path.join(directory, "edge.crt");
  if (!existsSync(key) || !existsSync(cert)) {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "3650",
      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ], { stdio: "ignore" });
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

export async function startEdge(input: { port: number; targetPort: number; certDirectory: string }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 64 });
  const server = http2.createSecureServer(certificate(input.certDirectory), (request, response) => {
    const authority = String(request.headers[":authority"] ?? `localhost:${input.port}`);
    const headers: OutgoingHttpHeaders = {};
    for (const [name, value] of Object.entries(request.headers)) {
      if (name.startsWith(":") || HOP_BY_HOP.has(name)) continue;
      headers[name] = value;
    }
    headers.host = authority;
    headers["x-forwarded-host"] = authority;
    headers["x-forwarded-proto"] = "https";
    headers["x-forwarded-for"] = "127.0.0.1";

    const upstream = http.request(
      { host: "127.0.0.1", port: input.targetPort, method: request.method, path: request.url, headers, agent },
      (answer) => {
        const out: OutgoingHttpHeaders = {};
        for (const [name, value] of Object.entries(answer.headers)) {
          if (!HOP_BY_HOP.has(name)) out[name] = value;
        }
        const accepts = String(request.headers["accept-encoding"] ?? "");
        const compress = !answer.headers["content-encoding"] && accepts.includes("gzip") &&
          COMPRESSIBLE.test(String(answer.headers["content-type"] ?? "")) && request.method !== "HEAD";
        if (compress) {
          delete out["content-length"];
          out["content-encoding"] = "gzip";
          out.vary = out.vary ? `${out.vary}, Accept-Encoding` : "Accept-Encoding";
          response.writeHead(answer.statusCode ?? 502, out);
          answer.pipe(zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })).pipe(response);
          return;
        }
        response.writeHead(answer.statusCode ?? 502, out);
        answer.pipe(response);
      },
    );
    upstream.on("error", () => { if (!response.destroyed) response.destroy(); });
    request.pipe(upstream);
  });
  await new Promise<void>((resolve) => server.listen(input.port, "127.0.0.1", resolve));
  return {
    close: () => new Promise<void>((resolve) => { agent.destroy(); server.close(() => resolve()); }),
  };
}

import { open } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ file: string }> };

const FILE = /^([a-f0-9]{64})\.(webm|m4a|mp3|ogg|jpg|png|webp|gif|mp4|mov)$/;
const CONTENT_TYPES: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

/** `bytes=start-end` within a file of `size` bytes, or null when it asks for nothing we have. */
function rangeOf(header: string | null, size: number): { start: number; end: number } | null | "whole" {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match) return "whole";
  const [, from, to] = match;
  if (!from && !to) return null;
  const start = from ? Number(from) : Math.max(0, size - Number(to));
  const end = from && to ? Math.min(Number(to), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

/**
 * `next start` snapshots the public directory at build time, so files the app
 * or the e2e fixtures write afterwards answer 404. Serve local uploads from
 * disk here; production reads them from Blob instead and never hits this route.
 * Players ask for byte ranges (Safari won't play a video without them), so a
 * Range request gets just those bytes.
 */
export async function GET(request: Request, { params }: RouteContext) {
  const { file } = await params;
  const match = FILE.exec(file);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const handle = await open(path.join(process.cwd(), "public", "uploads", file), "r").catch(() => null);
  if (!handle) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const { size } = await handle.stat();
    const headers = {
      "Content-Type": CONTENT_TYPES[match[2]] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };
    const range = rangeOf(request.headers.get("range"), size);
    if (range === null) {
      return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    const { start, end } = range === "whole" ? { start: 0, end: size - 1 } : range;
    const length = Math.max(0, end - start + 1);
    const bytes = new Uint8Array(length);
    if (length > 0) await handle.read(bytes, 0, length, start);
    return new NextResponse(bytes, {
      status: range === "whole" ? 200 : 206,
      headers: {
        ...headers,
        "Content-Length": String(length),
        ...(range === "whole" ? {} : { "Content-Range": `bytes ${start}-${end}/${size}` }),
      },
    });
  } finally {
    await handle.close();
  }
}

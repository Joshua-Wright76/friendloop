import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ file: string }> };

const FILE = /^([a-f0-9]{64})\.(webm|m4a|mp3|ogg|jpg|png|webp|gif)$/;
const CONTENT_TYPES: Record<string, string> = {
  webm: "audio/webm",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/**
 * `next start` snapshots the public directory at build time, so files the app
 * or the e2e fixtures write afterwards answer 404. Serve local uploads from
 * disk here; production reads them from Blob instead and never hits this route.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { file } = await params;
  const match = FILE.exec(file);
  if (!match) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const bytes = await readFile(path.join(process.cwd(), "public", "uploads", file)).catch(() => null);
  if (!bytes) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[match[2]] ?? "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

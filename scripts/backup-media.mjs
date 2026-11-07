#!/usr/bin/env node
/**
 * Download every file in the Vercel Blob store into a directory, for the backup
 * workflow to encrypt. Their paths are kept, so a restore can put them back at the
 * same names. Needs BLOB_READ_WRITE_TOKEN.
 */
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { list } from "@vercel/blob";

const target = process.argv[2];
if (!target) {
  console.error("Usage: backup-media.mjs <directory>");
  process.exit(1);
}

let cursor;
let count = 0;
let bytes = 0;
do {
  const page = await list({ cursor, limit: 1000 });
  for (const blob of page.blobs) {
    const destination = path.join(target, blob.pathname);
    if (!destination.startsWith(path.resolve(target) + path.sep) && !destination.startsWith(target + path.sep)) {
      throw new Error(`Refusing a path outside the backup: ${blob.pathname}`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    const response = await fetch(blob.url);
    if (!response.ok) throw new Error(`${blob.pathname}: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
    count += 1;
    bytes += blob.size;
  }
  cursor = page.cursor;
} while (cursor);

console.log(`backup-media: ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);

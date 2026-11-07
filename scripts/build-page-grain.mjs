#!/usr/bin/env node
/**
 * Writes public/textures/grain.png, the tile behind the page's film of noise.
 *
 *   node scripts/build-page-grain.mjs
 *
 * Each pixel is black or white at a random strength, so the tile averages out to
 * no colour and works the same on light and dark pages. How strong it looks is set
 * in the stylesheet. It's a PNG rather than an SVG filter because phones redraw a
 * filter over a fixed full-screen layer far more slowly than they repeat an image.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const SIZE = 128;
/** Few enough strengths to compress well, and more than the eye can tell apart at this opacity. */
const LEVELS = 16;

// A small fixed-seed generator, so rebuilding gives the same file.
let seed = 0x2f6e2b1;
function random() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed / 2 ** 32;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// Greyscale with alpha: a filter byte, then a shade and a strength for each pixel.
const rows = Buffer.alloc(SIZE * (1 + SIZE * 2));
for (let y = 0; y < SIZE; y += 1) {
  const start = y * (1 + SIZE * 2);
  for (let x = 0; x < SIZE; x += 1) {
    rows[start + 1 + x * 2] = random() < 0.5 ? 0 : 255;
    rows[start + 2 + x * 2] = Math.floor(random() * LEVELS) * Math.floor(255 / (LEVELS - 1));
  }
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 4; // greyscale with alpha

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

mkdirSync("public/textures", { recursive: true });
writeFileSync("public/textures/grain.png", png);
console.log(`public/textures/grain.png: ${SIZE}px, ${png.length} bytes`);

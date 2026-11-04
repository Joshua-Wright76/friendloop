import { deflateSync } from "node:zlib";

function crc32(bytes: Buffer): number {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * A real, decodable RGB PNG the size of a phone photo (6000×4000 by default).
 * Every sixth row is low-amplitude noise so the file stays well over 5 MB after
 * deflate; the rows between repeat the one above (PNG "Up" filter, zero delta).
 * Seeded, so the bytes are the same on every run.
 */
export function makePhonePng(width = 6000, height = 4000): Buffer {
  let seed = 0x2f6b1a3d;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed >>> 24;
  };
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    if (y % 6 === 0) {
      raw[row] = 0;
      for (let x = 0; x < width; x += 1) {
        const at = row + 1 + x * 3;
        raw[at] = 90 + (x % 120) + (random() & 31);
        raw[at + 1] = 120 + (random() & 31);
        raw[at + 2] = 60 + ((y >> 4) % 100) + (random() & 31);
      }
    } else {
      raw[row] = 2;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

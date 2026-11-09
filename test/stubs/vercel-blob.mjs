/**
 * The Blob store, in memory.
 *
 * `storePhoto`/`deleteStoredPhoto` are a boundary with somebody else's service;
 * a test that talks to the real one is an integration test with Vercel. This
 * records what the code asked for and returns the shape the SDK returns.
 */
/** @type {{ put: Array<{ pathname: string; options: unknown; size: number }>; del: Array<{ url: string; options: unknown }> }} */
export const calls = { put: [], del: [] };

/** How many of the next `del` calls should fail, the way a Blob outage would. */
export const failures = { del: 0, list: 0 };

export async function put(pathname, body, options) {
  calls.put.push({ pathname, options, size: body?.size ?? 0 });
  return { url: `https://store123.public.blob.vercel-storage.com/${pathname}` };
}

export async function del(url, options) {
  if (failures.del > 0) {
    failures.del -= 1;
    throw new Error("Blob is unavailable");
  }
  calls.del.push({ url, options });
  const index = stored.findIndex((blob) => blob.url === url);
  if (index >= 0) stored.splice(index, 1);
}

/**
 * Blobs the store holds, for `head` and `list`.
 * @type {Array<{ url: string; pathname: string; size: number; contentType: string; uploadedAt: Date }>}
 */
export const stored = [];

export async function head(url) {
  const blob = stored.find((candidate) => candidate.url === url);
  if (!blob) throw new Error("BlobNotFoundError");
  return blob;
}

/** Pages of two, so a caller that ignores the cursor misses blobs. */
export async function list({ prefix = "", cursor } = {}) {
  if (failures.list > 0) {
    failures.list -= 1;
    throw new Error("Blob is unavailable");
  }
  const matching = stored.filter((blob) => blob.pathname.startsWith(prefix));
  const start = cursor ? Number(cursor) : 0;
  const page = matching.slice(start, start + 2);
  const hasMore = start + 2 < matching.length;
  return { blobs: page, hasMore, ...(hasMore ? { cursor: String(start + 2) } : {}) };
}

export async function handleUpload() {
  throw new Error("handleUpload is a route concern; it is not exercised here");
}

export function reset() {
  calls.put.length = 0;
  calls.del.length = 0;
  failures.del = 0;
  failures.list = 0;
  stored.length = 0;
}

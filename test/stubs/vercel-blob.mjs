/**
 * The Blob store, in memory.
 *
 * `storePhoto`/`deleteStoredPhoto` are a boundary with somebody else's service;
 * a test that talks to the real one is an integration test with Vercel. This
 * records what the code asked for and returns the shape the SDK returns.
 */
export const calls = { put: [], del: [] };

export async function put(pathname, body, options) {
  calls.put.push({ pathname, options, size: body?.size ?? 0 });
  return { url: `https://store123.public.blob.vercel-storage.com/${pathname}` };
}

export async function del(url, options) {
  calls.del.push({ url, options });
}

export async function handleUpload() {
  throw new Error("handleUpload is a route concern; it is not exercised here");
}

export function reset() {
  calls.put.length = 0;
  calls.del.length = 0;
}

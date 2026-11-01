/**
 * The browser-side Blob uploader.
 *
 * `uploadReplyPhoto` in production validates the file, uploads it to Blob, then
 * polls our own route until the server has recorded it. This stub stands in for
 * the first half; the polling is real code against a fake fetcher.
 */
export const uploads = [];

export async function upload(pathname, file, options) {
  uploads.push({ pathname, size: file?.size ?? 0, options });
  return { url: `https://store123.public.blob.vercel-storage.com/${pathname}` };
}

export function reset() {
  uploads.length = 0;
}

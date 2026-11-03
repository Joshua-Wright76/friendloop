import type { Page } from "@playwright/test";

/**
 * A photo the size of a real one: 12 megapixels of noise as a high-quality JPEG,
 * which comes out well over 5 MB, the way a modern phone's camera roll does.
 * Drawn and encoded by the browser, so the test needs no image library.
 */
export async function cameraPhoto(page: Page, { width = 4000, height = 3000 } = {}): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d")!;
      const image = context.createImageData(w, h);
      // getRandomValues refuses more than 64 KiB at a time.
      for (let offset = 0; offset < image.data.length; offset += 65536) {
        crypto.getRandomValues(image.data.subarray(offset, Math.min(offset + 65536, image.data.length)));
      }
      for (let index = 3; index < image.data.length; index += 4) image.data[index] = 255;
      context.putImageData(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
      const bytes = new Uint8Array(await blob!.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      return btoa(binary);
    },
    [width, height],
  );
  return Buffer.from(base64, "base64");
}

/** The stored size and pixel dimensions of an uploaded picture, as the page serves it. */
export async function measureUpload(page: Page, url: string): Promise<{ bytes: number; width: number; height: number }> {
  const response = await page.request.get(url);
  const body = await response.body();
  const { width, height } = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  }, url);
  return { bytes: body.length, width, height };
}

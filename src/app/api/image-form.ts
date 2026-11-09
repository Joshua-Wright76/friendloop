import type { ImageInput } from "@/lib/identity";

async function formOf(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function imageIn(form: FormData): Promise<ImageInput | null> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
}

/** The one `photo` file of a multipart upload, or null when there is none. */
export async function imageFromRequest(request: Request): Promise<ImageInput | null> {
  const form = await formOf(request);
  return form ? imageIn(form) : null;
}

/**
 * A signature upload: its picture as `photo` and its pen strokes as JSON in
 * `strokes`. Null when either is missing; the strokes themselves are checked later.
 */
export async function signatureFromRequest(request: Request): Promise<{ image: ImageInput; strokes: unknown } | null> {
  const form = await formOf(request);
  if (!form) return null;
  const image = await imageIn(form);
  const raw = form.get("strokes");
  if (!image || typeof raw !== "string") return null;
  try {
    return { image, strokes: JSON.parse(raw) };
  } catch {
    return null;
  }
}

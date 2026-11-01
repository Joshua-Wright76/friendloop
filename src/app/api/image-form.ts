import type { ImageInput } from "@/lib/identity";

/** The one `photo` file of a multipart upload, or null when there is none. */
export async function imageFromRequest(request: Request): Promise<ImageInput | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
}

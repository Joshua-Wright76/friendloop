import { NextResponse } from "next/server";
import { removeSectionMediaFor, saveSectionPhotoFor } from "@/lib/sections";
import { copy } from "@/lib/copy";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Photos on section answers upload straight to the app, one per request. The
 * browser downscales them first (image-resize.ts), and validatePhoto caps each
 * at 4 MiB, under the platform's 4.5 MB request body limit.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.missingPhoto }, { status: 400 });
  }

  const issueSectionId = form.get("issueSectionId");
  const photo = form.get("photo");
  const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : "";
  const position = Number(form.get("position") ?? 0);
  if (typeof issueSectionId !== "string" || !issueSectionId) {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: copy.reply.errors.missingPhoto }, { status: 400 });
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const result = await saveSectionPhotoFor({
    token,
    issueSectionId,
    bytes,
    contentType: photo.type,
    caption,
    position,
  });
  return result.ok
    ? NextResponse.json({ ok: true, savedAt: result.savedAt, mediaId: result.mediaId, url: result.url })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let payload: { issueSectionId?: string; mediaId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }
  if (typeof payload.issueSectionId !== "string" || typeof payload.mediaId !== "string") {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }

  const result = await removeSectionMediaFor({
    token,
    issueSectionId: payload.issueSectionId,
    mediaId: payload.mediaId,
  });
  return result.ok
    ? NextResponse.json({ ok: true, savedAt: result.savedAt })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

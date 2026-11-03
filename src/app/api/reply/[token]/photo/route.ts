import { NextResponse } from "next/server";
import {
  authorizeQuestionForReply,
  deletePhotoIfUnreferenced,
  removePhotoFor,
  savePhotoFor,
} from "@/lib/reply";
import { storePhoto } from "@/lib/photo-storage";
import { MAX_PHOTO_BYTES, validatePhoto } from "@/lib/photo-validation";
import { copy } from "@/lib/copy";

type RouteContext = { params: Promise<{ token: string }> };

async function cleanupPhoto(photoUrl: string) {
  await deletePhotoIfUnreferenced(photoUrl).catch((error: unknown) => {
    console.error("Unable to clean up reply photo", error);
  });
}

/**
 * One multipart upload, stored by the server. The browser shrinks photos before
 * sending (src/components/prepare-image.ts), so the body stays well inside
 * Vercel's 4.5 MB request limit and no direct-to-Blob hand-off is needed.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.missingPhoto }, { status: 400 });
  }

  const issueQuestionId = form.get("issueQuestionId");
  const photo = form.get("photo");
  if (typeof issueQuestionId !== "string" || !issueQuestionId) {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }
  if (!(photo instanceof File)) {
    return NextResponse.json({ error: copy.reply.errors.missingPhoto }, { status: 400 });
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: copy.reply.errors.photoTooLarge }, { status: 413 });
  }

  const authorization = await authorizeQuestionForReply(token, issueQuestionId);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const bytes = new Uint8Array(await photo.arrayBuffer());
  const validation = validatePhoto(bytes, photo.type);
  if (!validation.ok) {
    const error = validation.reason === "too-large"
      ? copy.reply.errors.photoTooLarge
      : copy.reply.errors.invalidPhoto;
    return NextResponse.json({ error }, { status: validation.reason === "too-large" ? 413 : 415 });
  }

  let photoUrl: string | undefined;
  try {
    photoUrl = await storePhoto(bytes, validation.format);
    const result = await savePhotoFor({ token, issueQuestionId, photoUrl });
    if (!result.ok) {
      await cleanupPhoto(photoUrl);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ ok: true, savedAt: result.savedAt, photoUrl: result.photoUrl });
  } catch (error) {
    if (photoUrl) {
      await cleanupPhoto(photoUrl);
    }
    console.error("Unable to save reply photo", error);
    return NextResponse.json({ error: copy.reply.errors.photoUploadFailed }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let payload: { issueQuestionId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }
  if (typeof payload.issueQuestionId !== "string" || !payload.issueQuestionId) {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }

  const result = await removePhotoFor({ token, issueQuestionId: payload.issueQuestionId });
  return result.ok
    ? NextResponse.json({ ok: true, savedAt: result.savedAt })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import {
  authorizeQuestionForReply,
  deletePhotoIfUnreferenced,
  photoSavedFor,
  removePhotoFor,
  savePhotoFor,
} from "@/lib/reply";
import { isManagedBlobPhotoUrl, storePhoto } from "@/lib/photo-storage";
import { MAX_PHOTO_BYTES, validatePhoto } from "@/lib/photo-validation";
import { copy } from "@/lib/copy";

type RouteContext = { params: Promise<{ token: string }> };

class PhotoRouteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function cleanupPhoto(photoUrl: string) {
  await deletePhotoIfUnreferenced(photoUrl).catch((error: unknown) => {
    console.error("Unable to clean up reply photo", error);
  });
}

async function saveUploadedBlob(input: {
  token: string;
  issueQuestionId: string;
  photoUrl: string;
}) {
  if (!isManagedBlobPhotoUrl(input.photoUrl)) {
    return { ok: false as const, status: 400, error: copy.reply.errors.invalidPhoto };
  }

  const authorization = await authorizeQuestionForReply(input.token, input.issueQuestionId);
  if (!authorization.ok) {
    await cleanupPhoto(input.photoUrl);
    return authorization;
  }

  try {
    const response = await fetch(input.photoUrl);
    if (!response.ok) {
      await cleanupPhoto(input.photoUrl);
      return { ok: false as const, status: 502, error: copy.reply.errors.photoUploadFailed };
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES) {
      await cleanupPhoto(input.photoUrl);
      return { ok: false as const, status: 413, error: copy.reply.errors.photoTooLarge };
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const declaredType = response.headers.get("content-type")?.split(";", 1)[0];
    const validation = validatePhoto(bytes, declaredType);
    if (!validation.ok) {
      await cleanupPhoto(input.photoUrl);
      const tooLarge = validation.reason === "too-large";
      return {
        ok: false as const,
        status: tooLarge ? 413 : 415,
        error: tooLarge ? copy.reply.errors.photoTooLarge : copy.reply.errors.invalidPhoto,
      };
    }

    const result = await savePhotoFor(input);
    if (!result.ok) {
      await cleanupPhoto(input.photoUrl);
      return result;
    }
    return result;
  } catch (error) {
    await cleanupPhoto(input.photoUrl);
    console.error("Unable to verify uploaded Blob photo", error);
    return { ok: false as const, status: 500, error: copy.reply.errors.photoUploadFailed };
  }
}

async function handleBlobRequest(request: Request, token: string) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }

  if (payload.action === "checkBlob") {
    if (typeof payload.issueQuestionId !== "string" || typeof payload.photoUrl !== "string") {
      return NextResponse.json({ error: copy.reply.errors.invalidPhoto }, { status: 400 });
    }
    if (!isManagedBlobPhotoUrl(payload.photoUrl)) {
      return NextResponse.json({ error: copy.reply.errors.invalidPhoto }, { status: 400 });
    }
    const result = await photoSavedFor({
      token,
      issueQuestionId: payload.issueQuestionId,
      photoUrl: payload.photoUrl,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return result.saved
      ? NextResponse.json({ ok: true, photoUrl: payload.photoUrl })
      : NextResponse.json({ ok: false, pending: true }, { status: 202 });
  }

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) {
    return NextResponse.json({ error: copy.reply.errors.photoUploadFailed }, { status: 500 });
  }

  try {
    const result = await handleUpload({
      body: payload as unknown as HandleUploadBody,
      request,
      token: blobToken,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!/^reply-photos\/[a-f0-9]{64}\.(?:jpg|png|webp|gif)$/i.test(pathname)) {
          throw new PhotoRouteError(400, copy.reply.errors.invalidPhoto);
        }

        let clientData: { issueQuestionId?: string };
        try {
          clientData = JSON.parse(clientPayload ?? "") as { issueQuestionId?: string };
        } catch {
          throw new PhotoRouteError(400, copy.reply.errors.missingQuestion);
        }
        if (typeof clientData.issueQuestionId !== "string" || !clientData.issueQuestionId) {
          throw new PhotoRouteError(400, copy.reply.errors.missingQuestion);
        }

        const authorization = await authorizeQuestionForReply(token, clientData.issueQuestionId);
        if (!authorization.ok) throw new PhotoRouteError(authorization.status, authorization.error);

        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
          maximumSizeInBytes: MAX_PHOTO_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ token, issueQuestionId: clientData.issueQuestionId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let uploadData: { token?: string; issueQuestionId?: string };
        try {
          uploadData = JSON.parse(tokenPayload ?? "") as { token?: string; issueQuestionId?: string };
        } catch {
          await cleanupPhoto(blob.url);
          throw new PhotoRouteError(400, copy.reply.errors.invalidPhoto);
        }
        if (!uploadData.token || !uploadData.issueQuestionId) {
          await cleanupPhoto(blob.url);
          throw new PhotoRouteError(400, copy.reply.errors.invalidPhoto);
        }

        const saved = await saveUploadedBlob({
          token: uploadData.token,
          issueQuestionId: uploadData.issueQuestionId,
          photoUrl: blob.url,
        });
        if (!saved.ok) throw new PhotoRouteError(saved.status, saved.error);
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PhotoRouteError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Unable to authorize Vercel Blob upload", error);
    return NextResponse.json({ error: copy.reply.errors.photoUploadFailed }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  if (request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return handleBlobRequest(request, token);
  }

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

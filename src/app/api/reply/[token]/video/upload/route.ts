import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { uploadRefused, videoUploadRefused } from "@/lib/upload-limit";
import { authorizeVideoForReply } from "@/lib/reply";
import { VIDEO_BLOB_PATHNAME, videoUploadMode } from "@/lib/video-storage";
import { MAX_VIDEO_BYTES, VIDEO_CONTENT_TYPES } from "@/lib/video-validation";
import { copy } from "@/lib/copy";

type RouteContext = { params: Promise<{ token: string }> };

/** How long a signed upload stays usable: enough for a minute of video on a slow phone connection. */
const UPLOAD_WINDOW_MS = 30 * 60 * 1000;

class Refusal extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Sign one direct-to-Blob upload of a clip, for a reply link that can answer
 * the question it names. The browser picks a random name; the signature only
 * covers that name, video types and the size cap. Nothing points at the clip
 * until the browser attaches it through `/video`, and the sweep removes clips
 * that never get attached.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;
  if (videoUploadMode() !== "blob") return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }
  // Only signing happens here; no completion callback is ever registered.
  if (body.type !== "blob.generate-client-token") {
    return NextResponse.json({ error: copy.reply.errors.unknownAction }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const refused = await uploadRefused(token, copy.reply.errors.tooManyUploads);
        if (refused || (await videoUploadRefused(token))) throw new Refusal(copy.reply.errors.tooManyUploads, 429);
        if (!VIDEO_BLOB_PATHNAME.test(pathname)) throw new Refusal(copy.reply.errors.invalidVideo, 400);

        let issueQuestionId: unknown;
        try {
          issueQuestionId = (JSON.parse(clientPayload ?? "{}") as { issueQuestionId?: unknown }).issueQuestionId;
        } catch {
          issueQuestionId = undefined;
        }
        if (typeof issueQuestionId !== "string" || !issueQuestionId) {
          throw new Refusal(copy.reply.errors.missingQuestion, 400);
        }
        const authorization = await authorizeVideoForReply(token, issueQuestionId);
        if (!authorization.ok) throw new Refusal(authorization.error, authorization.status);

        return {
          allowedContentTypes: VIDEO_CONTENT_TYPES,
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60 * 60 * 24 * 365,
          validUntil: Date.now() + UPLOAD_WINDOW_MS,
        };
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Refusal) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: copy.reply.errors.videoUploadFailed }, { status: 400 });
  }
}

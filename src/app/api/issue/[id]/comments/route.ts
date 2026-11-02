import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { postComment } from "@/lib/comments";
import { copy } from "@/lib/copy";
import type { MentionPick } from "@/lib/mentions";
import { MAX_PHOTO_BYTES } from "@/lib/photo-validation";

type RouteContext = { params: Promise<{ id: string }> };

function field(form: FormData, name: string): string | undefined {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function picksFrom(raw: string | undefined): MentionPick[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) =>
      item && typeof item.id === "string" && typeof item.label === "string"
        ? [{ id: item.id, label: item.label }]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Post a comment. Multipart so a photo can ride along; the viewer is the signed-in
 * member or the `?m=` token the page was opened with, sent in the body so it never
 * lands in a URL or a log.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { id: issueId } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: copy.issue.errors.invalidRequest }, { status: 400 });
  }

  const photo = form.get("photo");
  if (photo instanceof File && photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: copy.issue.errors.photoTooLarge }, { status: 413 });
  }

  const result = await postComment({
    issueId,
    viewerToken: field(form, "viewerToken") ?? null,
    id: field(form, "id"),
    body: field(form, "body") ?? "",
    replyId: field(form, "replyId") ?? null,
    quoteCommentId: field(form, "quoteCommentId") ?? null,
    mentions: picksFrom(field(form, "mentions")),
    photo: photo instanceof File && photo.size > 0
      ? { bytes: new Uint8Array(await photo.arrayBuffer()), type: photo.type }
      : null,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath(`/i/${issueId}`);
  return NextResponse.json({ ok: true, id: result.id });
}

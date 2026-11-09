import { uploadRefused } from "@/lib/upload-limit";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { copy } from "@/lib/copy";
import { clearMemberSignature, setMemberSignature } from "@/lib/identity";
import { viewerFor } from "@/lib/permissions";
import { signatureFromRequest } from "../../../image-form";

type RouteContext = { params: Promise<{ id: string }> };

/** Your own signature in this loop, as a signed-in member. */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id);
  if (!viewer) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  const refused = await uploadRefused(`loop:${id}`, copy.identity.errors.tooManyUploads);
  if (refused) return refused;

  const upload = await signatureFromRequest(request);
  if (!upload) return NextResponse.json({ error: copy.identity.signature.invalid }, { status: 400 });

  const result = await setMemberSignature(viewer.membership.id, upload.strokes, upload.image);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, signature: result.signature, signaturePngUrl: result.url });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id);
  if (!viewer) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  await clearMemberSignature(viewer.membership.id);
  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, signature: null, signaturePngUrl: null });
}

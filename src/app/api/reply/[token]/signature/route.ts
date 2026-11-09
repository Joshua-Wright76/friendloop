import { uploadRefused } from "@/lib/upload-limit";
import { NextResponse } from "next/server";
import { copy } from "@/lib/copy";
import { clearMemberSignature, setMemberSignature } from "@/lib/identity";
import { resolveToken } from "@/lib/reply";
import { signatureFromRequest } from "../../../image-form";

type RouteContext = { params: Promise<{ token: string }> };

/** The reply link is the credential, as for the profile photo: only its own person signs. */
async function memberFor(token: string) {
  const context = await resolveToken(token);
  return context.state === "ok" || context.state === "reader" ? context.membership : null;
}

/** Your signature in this loop: its strokes and the picture your browser drew of them. */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const refused = await uploadRefused(token, copy.reply.errors.tooManyUploads);
  if (refused) return refused;
  const membership = await memberFor(token);
  if (!membership) return NextResponse.json({ error: copy.reply.errors.invalidLink }, { status: 403 });

  const upload = await signatureFromRequest(request);
  if (!upload) return NextResponse.json({ error: copy.identity.signature.invalid }, { status: 400 });

  const result = await setMemberSignature(membership.id, upload.strokes, upload.image);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, signature: result.signature, signaturePngUrl: result.url });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  const membership = await memberFor(token);
  if (!membership) return NextResponse.json({ error: copy.reply.errors.invalidLink }, { status: 403 });

  await clearMemberSignature(membership.id);
  return NextResponse.json({ ok: true, signature: null, signaturePngUrl: null });
}

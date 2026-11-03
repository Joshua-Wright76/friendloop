import { NextResponse } from "next/server";
import { copy } from "@/lib/copy";
import { clearMemberPhoto, setMemberPhoto } from "@/lib/identity";
import { resolveToken } from "@/lib/reply";
import { imageFromRequest } from "../../../image-form";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * The reply link is the credential: only the person it belongs to can set their
 * own photo. Readers have one too (their comments carry it), even though their
 * link opens no sheet.
 */
async function contributorFor(token: string) {
  const context = await resolveToken(token);
  return context.state === "ok" || context.state === "reader" ? context.membership : null;
}

export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;
  const membership = await contributorFor(token);
  if (!membership) return NextResponse.json({ error: copy.reply.errors.invalidLink }, { status: 403 });

  const image = await imageFromRequest(request);
  if (!image) return NextResponse.json({ error: copy.identity.errors.invalidImage }, { status: 400 });

  const result = await setMemberPhoto(membership.id, image);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, photoUrl: result.url });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  const membership = await contributorFor(token);
  if (!membership) return NextResponse.json({ error: copy.reply.errors.invalidLink }, { status: 403 });

  await clearMemberPhoto(membership.id);
  return NextResponse.json({ ok: true, photoUrl: null });
}

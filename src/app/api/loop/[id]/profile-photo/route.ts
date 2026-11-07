import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { copy } from "@/lib/copy";
import { clearMemberPhoto, setMemberLook, setMemberPhoto } from "@/lib/identity";
import { viewerFor } from "@/lib/permissions";
import { imageFromRequest } from "../../../image-form";

type RouteContext = { params: Promise<{ id: string }> };

/** Your own photo in this loop, as a signed-in member. */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id);
  if (!viewer) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  const image = await imageFromRequest(request);
  if (!image) return NextResponse.json({ error: copy.identity.errors.invalidImage }, { status: 400 });

  const result = await setMemberPhoto(viewer.membership.id, image);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, photoUrl: result.url });
}

/** Your own charm and frame in this loop. */
export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id);
  if (!viewer) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  const body = await request.json().catch(() => null);
  const result = body && typeof body === "object" ? await setMemberLook(viewer.membership.id, body) : { ok: false as const };
  if (!result.ok) return NextResponse.json({ error: copy.identity.look.error }, { status: 400 });

  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json(result);
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id);
  if (!viewer) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  await clearMemberPhoto(viewer.membership.id);
  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, photoUrl: null });
}

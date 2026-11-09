import { uploadRefused } from "@/lib/upload-limit";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { copy } from "@/lib/copy";
import { clearHeaderImage, setHeaderImage } from "@/lib/identity";
import { atLeast, viewerFor } from "@/lib/permissions";
import { imageFromRequest } from "../../../image-form";

type RouteContext = { params: Promise<{ id: string }> };

async function managerOf(groupId: string) {
  const viewer = await viewerFor(groupId);
  return viewer && atLeast(viewer.membership.access, "admin") ? viewer : null;
}

/** The loop's header picture. The owner and admins. */
export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!(await managerOf(id))) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  const refused = await uploadRefused(`loop:${id}`, copy.identity.errors.tooManyUploads);
  if (refused) return refused;

  const image = await imageFromRequest(request);
  if (!image) return NextResponse.json({ error: copy.identity.errors.invalidImage }, { status: 400 });

  const result = await setHeaderImage(id, image);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, url: result.url });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!(await managerOf(id))) return NextResponse.json({ error: copy.identity.errors.notAllowed }, { status: 403 });

  await clearHeaderImage(id);
  revalidatePath(`/g/${id}`, "layout");
  return NextResponse.json({ ok: true, url: null });
}

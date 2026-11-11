import { uploadRefused } from "@/lib/upload-limit";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { copy } from "@/lib/copy";
import { clearHeaderImage, setHeaderImage } from "@/lib/identity";
import { atLeast, viewerFor } from "@/lib/permissions";
import { imageFromRequest } from "../../../image-form";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { groups } from "@/db/schema";
import { url } from "@/lib/urls";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

async function managerOf(groupId: string) {
  const viewer = await viewerFor(groupId);
  return viewer && atLeast(viewer.membership.access, "admin") ? viewer : null;
}

/**
 * Where emails find the loop's picture (see `loopPictureUrl`). Old emails keep
 * asking long after the picture changes, so this always answers with today's,
 * and with a see-through strip once there is none, never a broken image.
 */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const [group] = UUID.test(id)
    ? await db.select({ url: groups.headerImageUrl }).from(groups).where(eq(groups.id, id)).limit(1)
    : [];
  const response = NextResponse.redirect(group?.url ? new URL(group.url, url("/")) : url("/email/no-picture.png"), 302);
  // Short, so a new picture reaches old emails soon; mail proxies cache on their own terms.
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
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

import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { loopArchive } from "@/lib/data-export";
import { exportResponse } from "@/lib/export-response";
import { viewerFor } from "@/lib/permissions";

type RouteContext = { params: Promise<{ id: string }> };

/** The owner's archive of the whole loop. Anyone else gets the same 404 as a missing loop. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  const viewer = await viewerFor(id).catch(() => null);
  if (!viewer || viewer.membership.access !== "owner") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const at = await getNow();
  const archive = await loopArchive(id, at);
  if (!archive) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return exportResponse(archive.chunks, archive.groupName, at);
}

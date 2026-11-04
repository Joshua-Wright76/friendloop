import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { replyLinkExport } from "@/lib/data-export";
import { exportResponse } from "@/lib/export-response";

type RouteContext = { params: Promise<{ token: string }> };

/** What this reply link's person wrote in its loop. The link is the credential, as on the sheet. */
export async function GET(_request: Request, { params }: RouteContext) {
  const { token } = await params;
  const at = await getNow();
  const found = await replyLinkExport(token, at);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return exportResponse(found.chunks, found.groupName, at);
}

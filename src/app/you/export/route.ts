import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getNow } from "@/lib/clock";
import { accountExport } from "@/lib/data-export";
import { exportResponse } from "@/lib/export-response";

/** Everything the signed-in person wrote, in every loop, as one JSON file. Read-only. */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/signin", request.url), 303);

  const at = await getNow();
  const chunks = await accountExport(user.id, at);
  if (!chunks) return NextResponse.redirect(new URL("/signin", request.url), 303);
  return exportResponse(chunks, "my-data", at);
}

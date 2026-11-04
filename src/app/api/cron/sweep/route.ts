import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runSweep } from "@/lib/sweep-run";

/**
 * The only scheduled entry point. Idempotent by construction, so it can be hit
 * by Vercel cron *and* by a GitHub Actions schedule, late, twice, or out of order.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const at = await getNow();
  const report = await runSweep(at);
  return NextResponse.json({ ok: true, at: at.toISOString(), ...report });
}

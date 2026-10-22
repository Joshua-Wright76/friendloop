import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { sweep } from "@/lib/sweep";

/**
 * The only scheduled entry point. Idempotent by construction, so it can be hit
 * by Vercel cron *and* by a GitHub Actions schedule, late, twice, or out of order.
 */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (!expected || provided !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const at = await getNow();
  const report = await sweep({ at });
  return NextResponse.json({ ok: true, at: at.toISOString(), ...report });
}

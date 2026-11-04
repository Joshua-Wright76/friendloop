import { NextResponse, connection } from "next/server";
import { pingDatabase } from "@/lib/health";
import { log } from "@/lib/log";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Public liveness for uptime monitors: the deployment answers and can reach its
 * database. No details, no auth — `/api/health` has the rest behind CRON_SECRET.
 */
export async function GET() {
  await connection();
  try {
    await pingDatabase();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    log.error("Liveness check could not reach the database", error);
    return NextResponse.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
}

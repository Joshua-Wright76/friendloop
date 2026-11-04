import { NextResponse } from "next/server";
import { getNow } from "@/lib/clock";
import { isCronAuthorized } from "@/lib/cron-auth";
import { readHealth } from "@/lib/health";
import { log } from "@/lib/log";

const NO_STORE = { "cache-control": "no-store" };

/**
 * Operational health, behind CRON_SECRET: has the sweep run recently, and is
 * any mail stuck in the outbox? 200 when both are fine, 503 with the details
 * otherwise. Probed by `.github/workflows/monitor.yml`.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const at = await getNow();
  try {
    const report = await readHealth(at);
    return NextResponse.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE });
  } catch (error) {
    log.error("Health check could not read the database", error);
    return NextResponse.json(
      { ok: false, at: at.toISOString(), error: "database unreachable" },
      { status: 503, headers: NO_STORE },
    );
  }
}

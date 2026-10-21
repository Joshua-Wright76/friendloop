import { NextResponse } from "next/server";

// Called by Vercel Cron once per day (see vercel.json).
// Hobby plan cron timing is approximate and limited to once/day —
// a weekly newsletter cadence fits that fine.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // TODO: the daily state machine —
  //   1. groups whose promptWeekday == today  → create Issue(open), email prompts via Resend
  //   2. issues whose deliversAt <= now        → compile replies, email the newsletter, mark delivered
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString() });
}

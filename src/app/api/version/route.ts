import { NextResponse, connection } from "next/server";

/**
 * The commit this deployment was built from, so the Verify production deploy
 * workflow can tell whether a merge reached production. The repo is public, so
 * the hash gives nothing away. Null outside Vercel.
 */
export async function GET() {
  await connection();
  return NextResponse.json(
    { commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null },
    { headers: { "cache-control": "no-store" } },
  );
}

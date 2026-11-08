import { renewSession } from "@/lib/auth";

/**
 * Signed-in pages call this at most once a day to push the session's year forward.
 * A server action can't do it quietly: setting a cookie from one refreshes the page,
 * which would cost someone the answer they're halfway through typing.
 */
export async function POST() {
  await renewSession();
  return new Response(null, { status: 204 });
}

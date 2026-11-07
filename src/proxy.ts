import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalUiPreview,
  previewCookieMatches,
  previewCookieName,
  previewKeyMatches,
} from "@/lib/ui-preview";

/**
 * Everything under /dev needs the key outside local development. The captured
 * inbox holds live sign-in links, the feedback inbox names the people who wrote
 * in, and /dev/ui signs its visitor in as the demo owner, who can invite anyone.
 * The one way in is a keyed visit to /dev/ui, which sets the cookie the rest check.
 * A denial has to be a real 404 status, which a page's notFound() cannot produce
 * once the shared shell has started streaming.
 */
export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (
    isLocalUiPreview() ||
    previewCookieMatches(request.cookies.get(previewCookieName())?.value) ||
    (pathname === "/dev/ui" && previewKeyMatches(searchParams.get("key")))
  ) {
    return NextResponse.next();
  }
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: ["/dev/:path*"],
};

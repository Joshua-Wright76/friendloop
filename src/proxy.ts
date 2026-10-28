import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalUiPreview,
  previewCookieMatches,
  previewCookieName,
  previewKeyMatches,
  previewSecret,
} from "@/lib/ui-preview";

/**
 * The hard door for /dev. The pages check again on their own, but a denial has
 * to be a real 404 status, which a page's notFound() cannot produce once the
 * shared shell has started streaming.
 */
export function proxy(request: NextRequest) {
  if (isLocalUiPreview()) return NextResponse.next();

  const keyOpensThisRequest =
    request.nextUrl.pathname.replace(/\/+$/, "") === "/dev/ui" &&
    previewKeyMatches(request.nextUrl.searchParams.get("key"));
  const cookieOpensRequest = previewCookieMatches(request.cookies.get(previewCookieName())?.value);

  if (previewSecret() && (keyOpensThisRequest || cookieOpensRequest)) {
    return NextResponse.next();
  }
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: "/dev/:path*",
};

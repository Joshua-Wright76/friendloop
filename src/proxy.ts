import { NextResponse, type NextRequest } from "next/server";
import {
  isLocalUiPreview,
  previewCookieMatches,
  previewCookieName,
} from "@/lib/ui-preview";

/**
 * The captured inbox is the one /dev page that stays locked: its emails hold
 * live sign-in links. The screens and email previews are sample data and need
 * no gate. A denial has to be a real 404 status, which a page's notFound()
 * cannot produce once the shared shell has started streaming.
 */
export function proxy(request: NextRequest) {
  if (isLocalUiPreview() || previewCookieMatches(request.cookies.get(previewCookieName())?.value)) {
    return NextResponse.next();
  }
  return new NextResponse(null, { status: 404 });
}

export const config = {
  matcher: "/dev/outbox",
};

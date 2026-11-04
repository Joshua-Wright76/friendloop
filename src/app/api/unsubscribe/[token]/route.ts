import { NextResponse } from "next/server";
import { copy } from "@/lib/copy";
import { safeBackPath, setMutedByToken } from "@/lib/unsubscribe";
import { unsubscribeUrl, url } from "@/lib/urls";

/**
 * A mail client that cannot one-click opens the `List-Unsubscribe` URL in a
 * browser. GET never mutates, so it lands on the page that asks first.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return NextResponse.redirect(unsubscribeUrl(token), 303);
}

/**
 * Two callers, one endpoint:
 *
 * - RFC 8058 one-click: the mailbox provider POSTs `List-Unsubscribe=One-Click`
 *   with no cookies and no confirmation step, and must get a 2xx. It mutes.
 * - The `/u/<token>` page (and the muted notice on the reply and issue pages):
 *   a plain form posting `action=mute|unmute`, answered with a 303 back.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = new URLSearchParams(await request.text());

  if (form.get("List-Unsubscribe") === "One-Click") {
    const ok = await setMutedByToken(token, true);
    return new NextResponse(ok ? copy.unsubscribe.oneClickDone : copy.unsubscribe.invalidTitle, {
      status: ok ? 200 : 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const action = form.get("action");
  if (action !== "mute" && action !== "unmute") {
    return new NextResponse(copy.unsubscribe.badRequest, {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const ok = await setMutedByToken(token, action === "mute");
  if (!ok) return NextResponse.redirect(unsubscribeUrl(token), 303);
  const back = safeBackPath(form.get("back"));
  return NextResponse.redirect(back ? url(back) : unsubscribeUrl(token), 303);
}

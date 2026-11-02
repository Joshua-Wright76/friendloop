import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { copy } from "@/lib/copy";
import { submitFeedback } from "@/lib/feedback";

/**
 * One POST behind the corner button. It answers anyone — a reader, a visitor
 * with no account — because the people who hit a bug are not always the ones
 * who can sign in.
 */
export async function POST(request: Request) {
  let payload: { message?: unknown; path?: unknown; viewport?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.feedback.errors.message }, { status: 400 });
  }

  const asText = (value: unknown) => (typeof value === "string" ? value : "");
  const user = await currentUser();
  const result = await submitFeedback(
    {
      message: asText(payload.message),
      path: asText(payload.path),
      userAgent: request.headers.get("user-agent") ?? "",
      viewport: asText(payload.viewport),
    },
    user,
  );

  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

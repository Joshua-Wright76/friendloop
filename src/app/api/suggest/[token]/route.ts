import { NextResponse } from "next/server";
import { createSuggestion } from "@/lib/suggestions";
import { copy } from "@/lib/copy";

/**
 * Contributor writes for suggestions live behind one POST endpoint, same rules
 * as the reply sheet: a reader gets a real 403.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let payload: { text?: string; authorDisplay?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }

  const result = await createSuggestion({
    token,
    text: typeof payload.text === "string" ? payload.text : "",
    authorDisplay: payload.authorDisplay === "anonymous" ? "anonymous" : "name",
  });

  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

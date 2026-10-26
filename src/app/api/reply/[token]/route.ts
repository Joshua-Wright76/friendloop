import { NextResponse } from "next/server";
import { saveDraftFor, saveNameFor, submitFor } from "@/lib/reply";
import { copy } from "@/lib/copy";

/**
 * Writes live behind one POST endpoint rather than a Server Action so the rules
 * are testable over HTTP: a reader or an expired invite gets a real 403.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let payload: { action?: string; issueQuestionId?: string; body?: string; name?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }

  if (payload.action === "submit") {
    const result = await submitFor(token);
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (payload.action === "name") {
    const result = await saveNameFor({
      token,
      name: typeof payload.name === "string" ? payload.name : "",
    });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (payload.action === "draft") {
    if (typeof payload.issueQuestionId !== "string") {
      return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
    }
    const result = await saveDraftFor({
      token,
      issueQuestionId: payload.issueQuestionId,
      body: typeof payload.body === "string" ? payload.body : "",
    });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ error: copy.reply.errors.unknownAction }, { status: 400 });
}

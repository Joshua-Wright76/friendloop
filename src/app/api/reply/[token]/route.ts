import { NextResponse } from "next/server";
import { confirmFor, saveDraftFor, saveNameFor, saveReminderPreferenceFor, savePollChoicesFor } from "@/lib/reply";
import { saveSectionMusicFor, saveSectionTextFor } from "@/lib/sections";
import { copy } from "@/lib/copy";

/**
 * Writes live behind one POST endpoint rather than a Server Action so the rules
 * are testable over HTTP: a reader or an expired invite gets a real 403.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let payload: { action?: string; issueQuestionId?: string; issueSectionId?: string; choices?: unknown; body?: string; name?: string; preference?: unknown; url?: string; caption?: string; ifBody?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }

  // Answers are in the round as soon as they save. "submit" is what a sheet
  // loaded before that still sends from its old "Send answers" button.
  if (payload.action === "submit") {
    const result = await confirmFor(token);
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

  if (payload.action === "reminders") {
    const result = await saveReminderPreferenceFor({ token, preference: payload.preference });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (payload.action === "sectionDraft") {
    if (typeof payload.issueSectionId !== "string") {
      return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
    }
    const result = await saveSectionTextFor({
      token,
      issueSectionId: payload.issueSectionId,
      body: typeof payload.body === "string" ? payload.body : "",
    });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (payload.action === "sectionMusic") {
    if (typeof payload.issueSectionId !== "string") {
      return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
    }
    const result = await saveSectionMusicFor({
      token,
      issueSectionId: payload.issueSectionId,
      url: typeof payload.url === "string" ? payload.url : "",
      caption: typeof payload.caption === "string" ? payload.caption : "",
    });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  if (payload.action === "pollChoice") {
    if (typeof payload.issueQuestionId !== "string") {
      return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
    }
    const result = await savePollChoicesFor({
      token,
      issueQuestionId: payload.issueQuestionId,
      choices: payload.choices,
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
      ifBody: typeof payload.ifBody === "string" ? payload.ifBody : undefined,
    });
    return result.ok
      ? NextResponse.json({ ok: true, savedAt: result.savedAt })
      : NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ error: copy.reply.errors.unknownAction }, { status: 400 });
}

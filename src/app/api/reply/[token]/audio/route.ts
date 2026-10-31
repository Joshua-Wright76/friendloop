import { NextResponse } from "next/server";
import { authorizeQuestionForReply, deleteAudioIfUnreferenced, removeAudioFor, saveAudioFor } from "@/lib/reply";
import { storeAudio } from "@/lib/media-storage";
import {
  MAX_AUDIO_BYTES,
  MAX_AUDIO_DURATION_MS,
  formatAudioDuration,
  validateAudio,
} from "@/lib/audio-validation";
import { copy } from "@/lib/copy";

type RouteContext = { params: Promise<{ token: string }> };

/**
 * Voice notes upload straight to the app: recordings are small (a 3-minute
 * opus note is a few hundred kilobytes), well under every serverless body
 * limit, so they skip the Blob client dance photos need.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.missingAudio }, { status: 400 });
  }

  const issueQuestionId = form.get("issueQuestionId");
  const audio = form.get("audio");
  const rawDuration = form.get("durationMs");
  const durationMs = typeof rawDuration === "string" ? Number(rawDuration) : Number.NaN;
  if (typeof issueQuestionId !== "string" || !issueQuestionId) {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: copy.reply.errors.missingAudio }, { status: 400 });
  }
  if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_AUDIO_DURATION_MS) {
    return NextResponse.json({ error: copy.reply.errors.voiceTooLong }, { status: 413 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: copy.reply.errors.voiceTooLarge }, { status: 413 });
  }

  const authorization = await authorizeQuestionForReply(token, issueQuestionId);
  if (!authorization.ok) {
    return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  }

  const bytes = new Uint8Array(await audio.arrayBuffer());
  const validation = validateAudio(bytes, audio.type);
  if (!validation.ok) {
    const tooLarge = validation.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? copy.reply.errors.voiceTooLarge : copy.reply.errors.invalidAudio },
      { status: tooLarge ? 413 : 415 },
    );
  }

  let audioUrl: string | undefined;
  try {
    const stored = await storeAudio(bytes, validation.format);
    audioUrl = stored;
    const result = await saveAudioFor({
      token,
      issueQuestionId,
      audioUrl: stored,
      audioDurationMs: Math.round(durationMs),
    });
    if (!result.ok) {
      if (audioUrl) await deleteAudioIfUnreferenced(audioUrl);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      ok: true,
      savedAt: result.savedAt,
      audioUrl: result.audioUrl,
      audioDurationMs: result.audioDurationMs,
      duration: formatAudioDuration(result.audioDurationMs),
    });
  } catch (error) {
    if (audioUrl) {
      await deleteAudioIfUnreferenced(audioUrl).catch(() => undefined);
    }
    console.error("Unable to save reply voice note", error);
    return NextResponse.json({ error: copy.reply.errors.audioSaveFailed }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { token } = await params;

  let payload: { issueQuestionId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: copy.reply.errors.json }, { status: 400 });
  }
  if (typeof payload.issueQuestionId !== "string" || !payload.issueQuestionId) {
    return NextResponse.json({ error: copy.reply.errors.missingQuestion }, { status: 400 });
  }

  const result = await removeAudioFor({ token, issueQuestionId: payload.issueQuestionId });
  return result.ok
    ? NextResponse.json({ ok: true, savedAt: result.savedAt })
    : NextResponse.json({ error: result.error }, { status: result.status });
}

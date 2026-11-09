import { hashToken } from "./tokens.ts";
import { consume, LIMITS, limitKey } from "./rate-limit.ts";

/**
 * Stops one link or loop filling the public Blob store. `null` means go ahead.
 * Files are checked in the routes, since this is the one thing they all share.
 */
export async function uploadRefused(subject: string, error: string): Promise<Response | null> {
  const { allowed } = await consume(limitKey.upload(hashToken(subject)), LIMITS.upload);
  return allowed ? null : Response.json({ error }, { status: 429 });
}

/** The tighter cap on clips, checked when a direct upload is signed: each one can be 50 MB. */
export async function videoUploadRefused(subject: string): Promise<boolean> {
  const { allowed } = await consume(limitKey.videoUpload(hashToken(subject)), LIMITS.videoUpload);
  return !allowed;
}

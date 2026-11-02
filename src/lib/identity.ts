import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { groups, issues, memberships } from "@/db/schema";
import { copy } from "./copy.ts";
import { cleanIssueName } from "./issue-name.ts";
import { deleteStoredPhoto, storePhoto } from "./photo-storage.ts";
import { MAX_AVATAR_BYTES, MAX_BANNER_BYTES, validatePhoto } from "./photo-validation.ts";
import { DEFAULT_PRESET, isPresetKey, normalizeHex, resolveTheme } from "./theme.ts";

export type ImageInput = { bytes: Uint8Array; type?: string };

export type ImageResult =
  | { ok: true; url: string }
  | { ok: false; status: 404 | 413 | 415 | 500; error: string };

/** Validate, size-check against this surface's own cap, and store. */
async function storeImage(
  image: ImageInput,
  limit: number,
  tooLarge: string,
  failed: string,
): Promise<ImageResult> {
  if (image.bytes.byteLength > limit) return { ok: false, status: 413, error: tooLarge };

  const checked = validatePhoto(image.bytes, image.type);
  if (!checked.ok) {
    return checked.reason === "too-large"
      ? { ok: false, status: 413, error: tooLarge }
      : { ok: false, status: 415, error: copy.identity.errors.invalidImage };
  }

  try {
    return { ok: true, url: await storePhoto(image.bytes, checked.format) };
  } catch (error) {
    console.error("Unable to store image", error);
    return { ok: false, status: 500, error: failed };
  }
}

async function discard(url: string | null | undefined) {
  if (!url) return;
  await deleteStoredPhoto(url).catch((error: unknown) => {
    console.error("Unable to remove a replaced image", error);
  });
}

/* ------------------------------ themes ------------------------------ */

export type ThemeInput = { preset: string; accent: string };

export type ThemeResult =
  | { ok: true; adjusted: boolean }
  | { ok: false; error: "preset" | "accent" };

/**
 * Save the owner's stationery. Gingham with no accent is stored as nothing at
 * all, so "back to the original" and "never changed it" are the same row.
 */
export async function saveTheme(groupId: string, input: ThemeInput): Promise<ThemeResult> {
  if (input.preset !== "" && !isPresetKey(input.preset)) return { ok: false, error: "preset" };
  const accent = input.accent.trim() === "" ? null : normalizeHex(input.accent);
  if (input.accent.trim() !== "" && !accent) return { ok: false, error: "accent" };

  const preset = !input.preset || input.preset === DEFAULT_PRESET ? null : input.preset;
  await db.update(groups).set({ themePreset: preset, themeAccent: accent }).where(eq(groups.id, groupId));

  return { ok: true, adjusted: resolveTheme({ preset, accent })?.adjusted ?? false };
}

export async function setHeaderImage(groupId: string, image: ImageInput): Promise<ImageResult> {
  const stored = await storeImage(
    image,
    MAX_BANNER_BYTES,
    copy.identity.errors.bannerTooLarge,
    copy.identity.errors.bannerFailed,
  );
  if (!stored.ok) return stored;

  const [before] = await db.select({ url: groups.headerImageUrl }).from(groups).where(eq(groups.id, groupId)).limit(1);
  if (!before) {
    await discard(stored.url);
    return { ok: false, status: 404, error: copy.identity.errors.bannerFailed };
  }
  await db.update(groups).set({ headerImageUrl: stored.url }).where(eq(groups.id, groupId));
  await discard(before.url);
  return stored;
}

export async function clearHeaderImage(groupId: string): Promise<void> {
  const [before] = await db.select({ url: groups.headerImageUrl }).from(groups).where(eq(groups.id, groupId)).limit(1);
  await db.update(groups).set({ headerImageUrl: null }).where(eq(groups.id, groupId));
  await discard(before?.url);
}

/* ---------------------------- issue names ---------------------------- */

export type RenameResult = { ok: true; name: string | null } | { ok: false };

/** The owner's name for a round, before or after it goes out. Empty puts "Round N" back. */
export async function renameIssue(groupId: string, issueId: string, raw: string): Promise<RenameResult> {
  const name = cleanIssueName(raw);
  const updated = await db
    .update(issues)
    .set({ name })
    .where(and(eq(issues.id, issueId), eq(issues.groupId, groupId)))
    .returning({ id: issues.id });
  return updated.length === 0 ? { ok: false } : { ok: true, name };
}

/* --------------------------- profile photos --------------------------- */

/**
 * A profile photo belongs to one membership, not to the person. Names follow a
 * person from loop to loop because an email handle is a poor byline; a face is
 * different. Someone can be one thing to their family and another to their
 * coworkers, and no loop's owner should be able to see a picture they chose
 * for a different audience, so nothing here propagates by email address.
 */
export async function setMemberPhoto(membershipId: string, image: ImageInput): Promise<ImageResult> {
  const stored = await storeImage(
    image,
    MAX_AVATAR_BYTES,
    copy.identity.errors.avatarTooLarge,
    copy.identity.errors.avatarFailed,
  );
  if (!stored.ok) return stored;

  const [before] = await db
    .select({ url: memberships.photoUrl })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);
  if (!before) {
    await discard(stored.url);
    return { ok: false, status: 404, error: copy.identity.errors.avatarFailed };
  }
  await db.update(memberships).set({ photoUrl: stored.url }).where(eq(memberships.id, membershipId));
  await discard(before.url);
  return stored;
}

export async function clearMemberPhoto(membershipId: string): Promise<void> {
  const [before] = await db
    .select({ url: memberships.photoUrl })
    .from(memberships)
    .where(eq(memberships.id, membershipId))
    .limit(1);
  await db.update(memberships).set({ photoUrl: null }).where(eq(memberships.id, membershipId));
  await discard(before?.url);
}

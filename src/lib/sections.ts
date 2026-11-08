import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  events,
  groups,
  issueSections,
  issues,
  memberships,
  musicLinks,
  sectionMedia,
  sectionReplies,
  sections,
} from "@/db/schema";
import { getNow } from "./clock";
import { copy } from "./copy.ts";
import { deleteStoredPhoto, storePhoto } from "./photo-storage";
import { resolveToken, type WriteResult } from "./reply";
import { validatePhoto } from "./photo-validation";
import { metadataUrl, parseMusicPage, type MusicMeta, type MusicProvider, type MusicTrack } from "./music-meta.ts";
import { log } from "./log";

export const SECTION_TITLE_MAX = 80;
export const SECTION_DESCRIPTION_MAX = 200;
export const MUSIC_CAPTION_MAX = 120;
export const PHOTO_WALL_MAX = 6;

export type SectionKind = "standard" | "photo_wall" | "music";
export type { MusicProvider, MusicTrack };

export type MusicCard = { title: string; artworkUrl: string | null; tracks: MusicTrack[]; trackCount: number };

export type MusicLinkCheck =
  | { ok: true; provider: MusicProvider }
  | { ok: false; error: string };

/**
 * Save-time validation is host and path shape only: no third-party fetch ever
 * blocks a reply. Metadata is looked up at render time through the cache.
 */
export function checkMusicLink(raw: string): MusicLinkCheck {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: copy.suggest.errors.musicLink };
  }
  if (parsed.protocol !== "https:") return { ok: false, error: copy.suggest.errors.musicLink };

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();

  if (host === "open.spotify.com" || host === "spotify.com" || host.endsWith(".spotify.com")) {
    if (/^\/(track|album|playlist|episode|show)\/[a-z0-9]+/i.test(path)) return { ok: true, provider: "spotify" };
    return { ok: false, error: copy.suggest.errors.musicLink };
  }

  if (
    host === "www.qobuz.com" ||
    host === "open.qobuz.com" ||
    host === "play.qobuz.com" ||
    host.endsWith(".qobuz.com")
  ) {
    if (/^\/[a-z0-9-]+\/(album|track|interpreter|playlists?|label)\//i.test(path) || /^\/(album|track|interpreter|playlists?|label)\//i.test(path)) {
      return { ok: true, provider: "qobuz" };
    }
    return { ok: false, error: copy.suggest.errors.musicLink };
  }

  if (host.endsWith(".bandcamp.com")) {
    if (/\/(track|album)\//.test(path)) return { ok: true, provider: "bandcamp" };
    return { ok: false, error: copy.suggest.errors.musicLink };
  }

  return { ok: false, error: copy.suggest.errors.musicLink };
}

const MUSIC_FETCH_TIMEOUT_MS = 4_000;

/** Read-through cache for music card metadata; misses degrade to a plain card. */
/**
 * Cards for many links in one query. Only a link with no card, or a stale one,
 * goes on to `musicCardFor` and the network; on a delivered round that is none.
 */
export async function musicCardsFor(links: Array<{ provider: MusicProvider; url: string }>): Promise<Map<string, MusicCard>> {
  const cards = new Map<string, MusicCard>();
  const urls = [...new Set(links.map((link) => link.url))];
  if (urls.length === 0) return cards;
  const rows = await db.select().from(musicLinks).where(inArray(musicLinks.url, urls));
  const now = Date.now();
  for (const row of rows) {
    if (now - row.fetchedAt.getTime() < MUSIC_CARD_FRESH_MS) {
      cards.set(row.url, {
        title: row.title ?? fallbackTitle(row.url),
        artworkUrl: row.artworkUrl,
        tracks: row.tracks ?? [],
        trackCount: row.trackCount ?? 0,
      });
    }
  }
  const missing = links.filter((link, index) => !cards.has(link.url) && links.findIndex((other) => other.url === link.url) === index);
  const fetched = await Promise.all(missing.map((link) => musicCardFor(link.provider, link.url)));
  missing.forEach((link, index) => cards.set(link.url, fetched[index]));
  return cards;
}

const MUSIC_CARD_FRESH_MS = 30 * 24 * 60 * 60 * 1000;

export async function musicCardFor(provider: MusicProvider, url: string): Promise<MusicCard> {
  const [cached] = await db.select().from(musicLinks).where(eq(musicLinks.url, url)).limit(1);
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < MUSIC_CARD_FRESH_MS;
  if (cached && fresh) {
    return {
      title: cached.title ?? fallbackTitle(url),
      artworkUrl: cached.artworkUrl,
      tracks: cached.tracks ?? [],
      trackCount: cached.trackCount ?? 0,
    };
  }

  let meta: MusicMeta | null = null;
  try {
    meta = await fetchMusicMeta(provider, url);
  } catch {
    meta = null;
  }

  const resolved = {
    title: meta?.title ?? cached?.title ?? fallbackTitle(url),
    artworkUrl: meta?.artworkUrl ?? cached?.artworkUrl ?? null,
    tracks: meta?.tracks ?? cached?.tracks ?? [],
    trackCount: meta?.trackCount ?? cached?.trackCount ?? 0,
  };

  if (meta) {
    const values = {
      title: meta.title,
      artworkUrl: meta.artworkUrl,
      tracks: meta.tracks,
      trackCount: meta.trackCount,
      fetchedAt: new Date(),
    };
    await db
      .insert(musicLinks)
      .values({ url, provider, ...values })
      .onConflictDoUpdate({ target: musicLinks.url, set: values });
  }

  return resolved;
}

function fallbackTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return slug.replace(/[-]+/g, " ").slice(0, 80) || parsed.hostname;
  } catch {
    return url;
  }
}

async function fetchMusicMeta(provider: MusicProvider, url: string): Promise<MusicMeta | null> {
  const response = await fetchWithTimeout(metadataUrl(provider, url));
  if (!response.ok) return null;
  return parseMusicPage(provider, await response.text());
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MUSIC_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "Friendloop/1.0 (+https://friendloop.dev)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keep the open round's sections in step with the loop's. A round is open from
 * one delivery to the next, so a section the owner adds, edits, moves or turns off
 * is meant for the round people are answering now. A section someone has started
 * writing in stays, words and all, so nobody's answer loses its question.
 */
export async function syncOpenRoundSections(groupId: string): Promise<void> {
  const [open] = await db
    .select({ id: issues.id })
    .from(issues)
    .where(and(eq(issues.groupId, groupId), eq(issues.status, "open")))
    .limit(1);
  if (!open) return;

  const pool = await db
    .select()
    .from(sections)
    .where(and(eq(sections.groupId, groupId), eq(sections.active, true), isNull(sections.archivedAt)))
    .orderBy(asc(sections.position));
  const wanted = new Map(pool.map((section) => [section.id, section]));

  const current = (await db.select().from(issueSections).where(eq(issueSections.issueId, open.id)))
    .filter((row) => row.sectionId !== null);
  const started = new Set(
    current.length === 0
      ? []
      : (
          await db
            .selectDistinct({ id: sectionReplies.issueSectionId })
            .from(sectionReplies)
            .where(and(eq(sectionReplies.issueId, open.id), inArray(sectionReplies.issueSectionId, current.map((row) => row.id))))
        ).map((row) => row.id),
  );

  const dropped = current.filter((row) => !wanted.has(row.sectionId!) && !started.has(row.id));
  if (dropped.length > 0) {
    await db.delete(issueSections).where(inArray(issueSections.id, dropped.map((row) => row.id)));
  }

  for (const row of current) {
    const section = wanted.get(row.sectionId!);
    if (!section) continue;
    // Once someone has written under a title, the title they answered stays.
    const words = started.has(row.id)
      ? {}
      : { title: section.title, emoji: section.emoji, description: section.description, adminOnly: section.adminOnly };
    const next = { ...row, ...words, position: section.position };
    const same =
      row.title === next.title &&
      row.emoji === next.emoji &&
      row.description === next.description &&
      row.adminOnly === next.adminOnly &&
      row.position === next.position;
    if (same) continue;
    await db
      .update(issueSections)
      .set({ ...words, position: section.position })
      .where(eq(issueSections.id, row.id));
  }

  const have = new Set(current.map((row) => row.sectionId));
  const added = pool.filter((section) => !have.has(section.id));
  if (added.length > 0) {
    await db
      .insert(issueSections)
      .values(
        added.map((section) => ({
          issueId: open.id,
          sectionId: section.id,
          kind: section.kind,
          title: section.title,
          emoji: section.emoji,
          description: section.description,
          adminOnly: section.adminOnly,
          position: section.position,
        })),
      )
      .onConflictDoNothing({ target: [issueSections.issueId, issueSections.sectionId] });
  }
}

/** Snapshot the loop's active sections into a fresh issue, after the questions. */
export async function snapshotSectionsForIssue(input: {
  group: typeof groups.$inferSelect;
  issueId: string;
}): Promise<number> {
  const pool = await db
    .select()
    .from(sections)
    .where(
      and(
        eq(sections.groupId, input.group.id),
        eq(sections.active, true),
        isNull(sections.archivedAt),
      ),
    )
    .orderBy(asc(sections.position));

  if (pool.length === 0) return 0;

  // A section added at the same moment may already have been synced in.
  await db
    .insert(issueSections)
    .values(
      pool.map((section) => ({
        issueId: input.issueId,
        sectionId: section.id,
        kind: section.kind,
        title: section.title,
        emoji: section.emoji,
        description: section.description,
        adminOnly: section.adminOnly,
        position: section.position,
      })),
    )
    .onConflictDoNothing({ target: [issueSections.issueId, issueSections.sectionId] });
  return pool.length;
}

type SectionGate =
  | {
      ok: true;
      issueId: string;
      issueSection: typeof issueSections.$inferSelect;
      membershipId: string;
      membershipAccess: "owner" | "admin" | "member";
      acceptedAt: Date | null;
    }
  | { ok: false; result: Extract<WriteResult, { ok: false }> };

/** Check the token and the snapshotted section before accepting a section write. */
async function ensureWritableSection(token: string, issueSectionId: string): Promise<SectionGate> {
  const context = await resolveToken(token);
  if (context.state === "invalid") {
    return { ok: false, result: { ok: false, status: 404, error: copy.reply.errors.invalidLink } };
  }
  if (context.state === "reader") {
    return { ok: false, result: { ok: false, status: 403, error: copy.reply.errors.reader } };
  }

  const { membership, issue } = context;
  if (!issue) {
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.nothingOpen } };
  }

  const [section] = await db
    .select()
    .from(issueSections)
    .where(and(eq(issueSections.id, issueSectionId), eq(issueSections.issueId, issue.id)))
    .limit(1);
  if (!section) {
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.wrongQuestion } };
  }
  if (section.adminOnly && membership.access === "member") {
    return { ok: false, result: { ok: false, status: 403, error: copy.reply.errors.reader } };
  }
  if ((await celebratedMembers([section])).get(section.id) === membership.id) {
    // The birthday person never sees their own card, so they can't write to it.
    return { ok: false, result: { ok: false, status: 409, error: copy.reply.errors.wrongQuestion } };
  }

  return {
    ok: true,
    issueId: issue.id,
    issueSection: section,
    membershipId: membership.id,
    membershipAccess: membership.access,
    acceptedAt: membership.acceptedAt,
  };
}

async function markAccepted(membershipId: string, acceptedAt: Date | null, at: Date) {
  if (!acceptedAt) {
    await db.update(memberships).set({ acceptedAt: at }).where(eq(memberships.id, membershipId));
  }
}

export type SectionReplyWriteResult =
  | { ok: true; savedAt: string }
  | { ok: false; status: 400 | 403 | 404 | 409; error: string };

async function touchSectionReply(input: {
  issueId: string;
  issueSectionId: string;
  membershipId: string;
  patch: Partial<typeof sectionReplies.$inferInsert>;
  at: Date;
}): Promise<void> {
  await db
    .insert(sectionReplies)
    .values({
      issueId: input.issueId,
      issueSectionId: input.issueSectionId,
      membershipId: input.membershipId,
      status: "draft",
      ...input.patch,
      updatedAt: input.at,
    })
    .onConflictDoUpdate({
      target: [sectionReplies.issueId, sectionReplies.issueSectionId, sectionReplies.membershipId],
      set: { ...input.patch, updatedAt: input.at },
    });
}

/** Autosave the standard-section text or a music caption. */
export async function saveSectionTextFor(input: {
  token: string;
  issueSectionId: string;
  body: string;
}): Promise<SectionReplyWriteResult> {
  const gate = await ensureWritableSection(input.token, input.issueSectionId);
  if (!gate.ok) return gate.result;
  if (input.body.length > 2_000) {
    return { ok: false, status: 400, error: copy.reply.errors.sectionSaveFailed };
  }

  const at = await getNow();
  await touchSectionReply({
    issueId: gate.issueId,
    issueSectionId: gate.issueSection.id,
    membershipId: gate.membershipId,
    patch: { body: input.body },
    at,
  });
  await markAccepted(gate.membershipId, gate.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/** Paste a music pick; host-and-shape validation only, no third-party call. */
export async function saveSectionMusicFor(input: {
  token: string;
  issueSectionId: string;
  url: string;
  caption: string;
}): Promise<SectionReplyWriteResult> {
  const gate = await ensureWritableSection(input.token, input.issueSectionId);
  if (!gate.ok) return gate.result;
  if (gate.issueSection.kind !== "music") {
    return { ok: false, status: 400, error: copy.reply.errors.sectionSaveFailed };
  }

  const at = await getNow();
  const url = input.url.trim();

  if (!url) {
    await touchSectionReply({
      issueId: gate.issueId,
      issueSectionId: gate.issueSection.id,
      membershipId: gate.membershipId,
      patch: { linkUrl: null, linkProvider: null, body: input.caption.slice(0, MUSIC_CAPTION_MAX) },
      at,
    });
    await markAccepted(gate.membershipId, gate.acceptedAt, at);
    return { ok: true, savedAt: at.toISOString() };
  }

  const check = checkMusicLink(url);
  if (!check.ok) return { ok: false, status: 400, error: check.error };

  await touchSectionReply({
    issueId: gate.issueId,
    issueSectionId: gate.issueSection.id,
    membershipId: gate.membershipId,
    patch: {
      linkUrl: url,
      linkProvider: check.provider,
      body: input.caption.slice(0, MUSIC_CAPTION_MAX),
    },
    at,
  });
  await markAccepted(gate.membershipId, gate.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

export type SectionMediaWriteResult =
  | { ok: true; savedAt: string; mediaId: string; url: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413 | 415 | 500; error: string };

/** Attach one photo to a section answer; photo walls allow up to six, each with an optional caption. */
export async function saveSectionPhotoFor(input: {
  token: string;
  issueSectionId: string;
  bytes: Uint8Array;
  contentType?: string;
  caption: string;
  position: number;
}): Promise<SectionMediaWriteResult> {
  const gate = await ensureWritableSection(input.token, input.issueSectionId);
  if (!gate.ok) return gate.result;
  if (gate.issueSection.kind !== "standard" && gate.issueSection.kind !== "photo_wall") {
    return { ok: false, status: 400, error: copy.reply.errors.invalidPhoto };
  }

  const validation = validatePhoto(input.bytes, input.contentType);
  if (!validation.ok) {
    const tooLarge = validation.reason === "too-large";
    return {
      ok: false,
      status: tooLarge ? 413 : 415,
      error: tooLarge ? copy.reply.errors.photoTooLarge : copy.reply.errors.invalidPhoto,
    };
  }

  const [existingReply] = await db
    .select({ id: sectionReplies.id })
    .from(sectionReplies)
    .where(
      and(
        eq(sectionReplies.issueId, gate.issueId),
        eq(sectionReplies.issueSectionId, gate.issueSection.id),
        eq(sectionReplies.membershipId, gate.membershipId),
      ),
    )
    .limit(1);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sectionMedia)
    .where(
      existingReply
        ? eq(sectionMedia.sectionReplyId, existingReply.id)
        : sql`false`,
    );

  const cap = gate.issueSection.kind === "photo_wall" ? PHOTO_WALL_MAX : 1;
  if (count >= cap) {
    return {
      ok: false,
      status: 409,
      error: gate.issueSection.kind === "photo_wall"
        ? copy.reply.errors.sectionPhotoCap
        : copy.reply.errors.sectionPhotoStandardCap,
    };
  }

  const at = await getNow();
  let photoUrl: string;
  try {
    photoUrl = await storePhoto(input.bytes, validation.format);
  } catch {
    return { ok: false, status: 500, error: copy.reply.errors.photoUploadFailed };
  }

  let replyId = existingReply?.id;
  if (!replyId) {
    const [created] = await db
      .insert(sectionReplies)
      .values({
        issueId: gate.issueId,
        issueSectionId: gate.issueSection.id,
        membershipId: gate.membershipId,
        body: "",
        status: "draft",
      })
      .returning({ id: sectionReplies.id });
    replyId = created.id;
  }

  const [media] = await db
    .insert(sectionMedia)
    .values({
      sectionReplyId: replyId,
      url: photoUrl,
      caption: gate.issueSection.kind === "photo_wall" ? input.caption.trim().slice(0, 200) || null : null,
      position: Math.max(0, Math.min(5, Math.round(input.position) || count)),
    })
    .returning({ id: sectionMedia.id });

  await markAccepted(gate.membershipId, gate.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString(), mediaId: media.id, url: photoUrl };
}

/** Remove one photo from a section answer. */
export async function removeSectionMediaFor(input: {
  token: string;
  issueSectionId: string;
  mediaId: string;
}): Promise<SectionReplyWriteResult> {
  const gate = await ensureWritableSection(input.token, input.issueSectionId);
  if (!gate.ok) return gate.result;

  const [media] = await db
    .select({ id: sectionMedia.id, url: sectionMedia.url, sectionReplyId: sectionMedia.sectionReplyId })
    .from(sectionMedia)
    .innerJoin(sectionReplies, eq(sectionReplies.id, sectionMedia.sectionReplyId))
    .where(
      and(
        eq(sectionMedia.id, input.mediaId),
        eq(sectionReplies.issueId, gate.issueId),
        eq(sectionReplies.issueSectionId, gate.issueSection.id),
        eq(sectionReplies.membershipId, gate.membershipId),
      ),
    )
    .limit(1);
  if (!media) {
    return { ok: false, status: 404, error: copy.reply.errors.sectionSaveFailed };
  }

  const at = await getNow();
  await db.delete(sectionMedia).where(eq(sectionMedia.id, media.id));

  await deleteStoredPhoto(media.url).catch((error: unknown) => {
    log.error("Unable to remove section photo", error);
  });
  await markAccepted(gate.membershipId, gate.acceptedAt, at);
  return { ok: true, savedAt: at.toISOString() };
}

/**
 * Section id → the member an event section celebrates. A birthday card is a
 * surprise, so its own subject must not be asked to fill it in.
 */
async function celebratedMembers(
  rows: { id: string; eventId: string | null }[],
): Promise<Map<string, string>> {
  const eventIds = [...new Set(rows.map((row) => row.eventId).filter((id): id is string => Boolean(id)))];
  if (eventIds.length === 0) return new Map();
  const found = await db
    .select({ id: events.id, membershipId: events.membershipId })
    .from(events)
    .where(inArray(events.id, eventIds));
  const byEvent = new Map(found.map((event) => [event.id, event.membershipId]));
  const result = new Map<string, string>();
  for (const row of rows) {
    const member = row.eventId ? byEvent.get(row.eventId) : null;
    if (member) result.set(row.id, member);
  }
  return result;
}

/** The sheet's section payload: visible snapshots plus this member's answers. */
export async function sectionsForSheet(token: string, issueId: string) {
  const context = await resolveToken(token);
  if (context.state !== "ok") return [];

  const rows = await db
    .select()
    .from(issueSections)
    .where(eq(issueSections.issueId, issueId))
    .orderBy(asc(issueSections.position));

  const celebrated = await celebratedMembers(rows);
  const visible = rows.filter(
    (section) =>
      (!section.adminOnly || context.membership.access !== "member") &&
      celebrated.get(section.id) !== context.membership.id,
  );
  if (visible.length === 0) return [];

  const mine = await db
    .select()
    .from(sectionReplies)
    .where(
      and(eq(sectionReplies.issueId, issueId), eq(sectionReplies.membershipId, context.membership.id)),
    );

  const media = mine.length
    ? await db
        .select()
        .from(sectionMedia)
        .where(inArray(sectionMedia.sectionReplyId, mine.map((reply) => reply.id)))
        .orderBy(asc(sectionMedia.position))
    : [];

  return visible.map((section) => {
    const reply = mine.find((candidate) => candidate.issueSectionId === section.id);
    return {
      id: section.id,
      kind: section.kind,
      title: section.title,
      emoji: section.emoji,
      description: section.description,
      body: reply?.body ?? "",
      linkUrl: reply?.linkUrl ?? "",
      linkProvider: reply?.linkProvider ?? "",
      submitted: reply?.status === "submitted",
      media: media
        .filter((item) => reply && item.sectionReplyId === reply.id)
        .map((item) => ({ id: item.id, url: item.url, caption: item.caption })),
    };
  });
}

export type SheetSection = Awaited<ReturnType<typeof sectionsForSheet>>[number];

/** Flip this member's section answers to submitted alongside their question replies. */
export async function submitSectionsFor(input: {
  issueId: string;
  membershipId: string;
  membershipAcceptedAt: Date | null;
  at: Date;
  afterDelivery: boolean;
}): Promise<void> {
  await db
    .update(sectionReplies)
    .set({
      status: "submitted",
      submittedAt: input.at,
      addedAfterDelivery: input.afterDelivery,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(sectionReplies.issueId, input.issueId),
        eq(sectionReplies.membershipId, input.membershipId),
      ),
    );
}

// --- owner-side management -------------------------------------------------

export async function sectionsOf(groupId: string) {
  return db
    .select()
    .from(sections)
    .where(and(eq(sections.groupId, groupId), isNull(sections.archivedAt)))
    .orderBy(asc(sections.position));
}

export async function createSection(input: {
  groupId: string;
  kind: SectionKind;
  title: string;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  at: Date;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title || title.length > SECTION_TITLE_MAX) {
    return { ok: false, error: copy.reply.errors.sectionSaveFailed };
  }
  const [{ maxPosition }] = await db
    .select({ maxPosition: sql<number>`coalesce(max(${sections.position}), -1)::int` })
    .from(sections)
    .where(eq(sections.groupId, input.groupId));

  await db.insert(sections).values({
    groupId: input.groupId,
    kind: input.kind,
    title,
    emoji: input.emoji?.trim()?.slice(0, 8) || null,
    description: input.description?.trim()?.slice(0, SECTION_DESCRIPTION_MAX) || null,
    adminOnly: input.adminOnly,
    position: maxPosition + 1,
    createdAt: input.at,
  });
  await syncOpenRoundSections(input.groupId);
  return { ok: true };
}

export async function updateSection(input: {
  groupId: string;
  sectionId: string;
  title: string;
  emoji: string | null;
  description: string | null;
  adminOnly: boolean;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const title = input.title.trim();
  if (!title || title.length > SECTION_TITLE_MAX) {
    return { ok: false, error: copy.reply.errors.sectionSaveFailed };
  }
  await db
    .update(sections)
    .set({
      title,
      emoji: input.emoji?.trim()?.slice(0, 8) || null,
      description: input.description?.trim()?.slice(0, SECTION_DESCRIPTION_MAX) || null,
      adminOnly: input.adminOnly,
      active: input.active,
    })
    .where(and(eq(sections.id, input.sectionId), eq(sections.groupId, input.groupId)));
  await syncOpenRoundSections(input.groupId);
  return { ok: true };
}

export async function moveSection(input: {
  groupId: string;
  sectionId: string;
  targetIndex: number;
}): Promise<void> {
  const pool = await sectionsOf(input.groupId);
  const ordered = pool.filter((section) => section.id !== input.sectionId);
  const moving = pool.find((section) => section.id === input.sectionId);
  if (!moving) return;
  ordered.splice(Math.max(0, Math.min(ordered.length, input.targetIndex)), 0, moving);
  let position = 0;
  for (const section of ordered) {
    if (section.position !== position) {
      await db.update(sections).set({ position }).where(eq(sections.id, section.id));
    }
    position += 1;
  }
  await syncOpenRoundSections(input.groupId);
}

export async function archiveSection(input: { groupId: string; sectionId: string; at: Date }): Promise<void> {
  await db
    .update(sections)
    .set({ archivedAt: input.at, active: false })
    .where(and(eq(sections.id, input.sectionId), eq(sections.groupId, input.groupId)));
  await syncOpenRoundSections(input.groupId);
}

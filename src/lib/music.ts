import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { musicLinks } from "@/db/schema";
import { copy } from "./copy.ts";
import { metadataUrl, parseMusicPage, type MusicMeta, type MusicProvider, type MusicTrack } from "./music-meta.ts";

/*
 * Music picks: a link someone pasted, checked by shape when it is saved and
 * dressed as a card (title, artwork, tracks) from a cache when it is read.
 */

export const MUSIC_CAPTION_MAX = 120;
export const PHOTO_WALL_MAX = 6;

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


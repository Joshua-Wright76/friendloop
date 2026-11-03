/**
 * Reads a music card's title, artwork, and songs out of the provider's public
 * page. Pure string work, so the network and the cache stay in sections.ts.
 */

export type MusicProvider = "spotify" | "bandcamp" | "qobuz";

export type MusicTrack = { title: string; artist: string | null; seconds: number | null };

export type MusicMeta = {
  title: string | null;
  artworkUrl: string | null;
  tracks: MusicTrack[];
  trackCount: number;
};

/** The card keeps a short preview; the count says how many more there are. */
export const MUSIC_TRACKS_KEPT = 8;

/** The page that carries the metadata for a pasted link. */
export function metadataUrl(provider: MusicProvider, url: string): string {
  if (provider === "spotify") {
    const parsed = new URL(url);
    return `https://open.spotify.com/embed${parsed.pathname.replace(/^\/intl-[a-z-]+/i, "")}`;
  }
  if (provider === "qobuz") {
    // open./play. links are an app shell; the store page has the same id under a
    // placeholder slug and redirects to the real one.
    const parsed = new URL(url);
    const match = /^\/(playlist|album)\/([a-z0-9]+)\/?$/i.exec(parsed.pathname);
    if (parsed.hostname !== "www.qobuz.com" && match) {
      const kind = match[1].toLowerCase() === "playlist" ? "playlists" : "album";
      return `https://www.qobuz.com/us-en/${kind}/x/${match[2]}`;
    }
  }
  return url;
}

export function parseMusicPage(provider: MusicProvider, html: string): MusicMeta | null {
  if (provider === "spotify") return parseSpotifyEmbed(html);
  if (provider === "bandcamp") return parseBandcampPage(html);
  return parseQobuzPage(html);
}

type SpotifyEntity = {
  name?: string;
  title?: string;
  subtitle?: string;
  trackList?: Array<{ title?: string; subtitle?: string; duration?: number }>;
  visualIdentity?: { image?: Array<{ url?: string; maxWidth?: number }> };
};

export function parseSpotifyEmbed(html: string): MusicMeta | null {
  const json = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) return null;
  let entity: SpotifyEntity | undefined;
  try {
    entity = JSON.parse(json)?.props?.pageProps?.state?.data?.entity;
  } catch {
    return null;
  }
  if (!entity) return null;

  const name = entity.name ?? entity.title ?? null;
  const title = name && entity.subtitle ? `${name} — ${entity.subtitle}` : name;
  // The 300px rendition is plenty for a 48px tile on a dense screen.
  const images = (entity.visualIdentity?.image ?? []).filter((image) => image.url);
  const artwork = images.find((image) => image.maxWidth === 300) ?? images[0];
  const list = (entity.trackList ?? []).filter((track) => track.title);
  const tracks = list.slice(0, MUSIC_TRACKS_KEPT).map((track) => ({
    title: track.title!,
    artist: track.subtitle ?? null,
    seconds: typeof track.duration === "number" ? Math.round(track.duration / 1000) : null,
  }));
  if (!title && !artwork) return null;
  return { title, artworkUrl: artwork?.url ?? null, tracks, trackCount: list.length };
}

export function parseBandcampPage(html: string): MusicMeta | null {
  const ogTitle = decodeEntities(metaContent(html, "og:title"));
  const artworkUrl = metaContent(html, "og:image");
  if (!ogTitle && !artworkUrl) return null;
  // "In Rainbows, by Radiohead" reads like the other cards as "In Rainbows — Radiohead".
  const byline = ogTitle ? /^(.*), by (.*)$/.exec(ogTitle) : null;
  const title = byline ? `${byline[1]} — ${byline[2]}` : ogTitle;

  const rows = html.split(/<tr class="track_row_view/).slice(1);
  const all = rows.flatMap((row) => {
    const name = /class="track-title"[^>]*>([^<]+)</.exec(row)?.[1];
    if (!name) return [];
    const time = /class="time[^"]*"[^>]*>\s*([0-9:]+)/.exec(row)?.[1];
    return [{ title: decodeEntities(name.trim())!, artist: null, seconds: clockSeconds(time) }];
  });
  return { title, artworkUrl, tracks: all.slice(0, MUSIC_TRACKS_KEPT), trackCount: all.length };
}

export function parseQobuzPage(html: string): MusicMeta | null {
  const og = decodeEntities(metaContent(html, "og:title"));
  const pageTitle = decodeEntities(/<title>([^<]+)</i.exec(html)?.[1]?.trim() ?? null);
  // Playlist pages carry a bare "Qobuz" og:title and the site logo as og:image.
  const raw = og && og !== "Qobuz" ? og : pageTitle;
  const cleaned = raw
    ?.replace(/\s+-\s+Qobuz$/i, "")
    .replace(/\s+-\s+Streaming Hi-Res$/i, "")
    .replace(/^Playlist\s+/i, "");
  const title = cleaned && cleaned !== "Qobuz" ? cleaned : null;
  const image = metaContent(html, "og:image");
  const artworkUrl = image && !/qobuz_logo/i.test(image) ? image : null;
  if (!title && !artworkUrl) return null;

  const rows = html.split(/<div class="track[ "]/).slice(1);
  const all = rows.flatMap((row) => {
    const name = /track__item--name"[^>]*>\s*<span>([^<]+)<\/span>/.exec(row)?.[1];
    if (!name) return [];
    const artist = /track__item--artist" title="([^"]*)"/.exec(row)?.[1];
    const time = /track__item--duration">([0-9:]+)</.exec(row)?.[1];
    return [{ title: decodeEntities(name.trim())!, artist: decodeEntities(artist?.trim() || null), seconds: clockSeconds(time) }];
  });
  const declared = Number(/data-nbtracks="(\d+)"/.exec(html)?.[1] ?? 0);
  return { title, artworkUrl, tracks: all.slice(0, MUSIC_TRACKS_KEPT), trackCount: Math.max(declared, all.length) };
}

/** "3:57" or "00:03:57" to seconds; blanks stay unknown. */
export function clockSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part))) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** 237 to "3:57"; an hour-long track gets "1:02:05". */
export function formatTrackTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = String(seconds % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function metaContent(html: string, property: string): string | null {
  const pattern = new RegExp(`<meta[^>]+property="${property}"[^>]+content="([^"]+)"`, "i");
  return pattern.exec(html)?.[1] ?? null;
}

export function decodeEntities(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

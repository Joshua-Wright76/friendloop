/** Items on the first screen, and each "Show more" after it. */
export const ALBUM_PAGE_SIZE = 24;
/** Nobody scrolls past this, and it keeps a hand-edited URL from asking for the moon. */
export const ALBUM_MAX_PAGES = 40;

const MAX_QUERY_LENGTH = 80;
const MAX_TERMS = 6;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AlbumFilters = {
  /** A membership id; null means everyone. */
  member: string | null;
  /** What the person typed, tidied; "" means no search. */
  q: string;
  /** How many screens of results to show, from 1. */
  pages: number;
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Whatever arrived in the URL, made safe: a bad value is the same as no filter at all. */
export function parseAlbumFilters(params: Record<string, string | string[] | undefined>): AlbumFilters {
  const member = first(params.member).trim();
  const pages = Number.parseInt(first(params.pages), 10);
  return {
    member: UUID.test(member) ? member.toLowerCase() : null,
    q: first(params.q).replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH).trim(),
    pages: Number.isFinite(pages) ? Math.min(Math.max(pages, 1), ALBUM_MAX_PAGES) : 1,
  };
}

/** The words a search has to find, all of them, in any order. */
export function searchTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_TERMS);
}

/** Make a typed word literal inside an `ILIKE`: `%` and `_` are only wildcards when we say so. */
export function escapeLike(word: string): string {
  return word.replace(/[\\%_]/g, "\\$&");
}

/** Where the Album lives for this viewer, with whatever filters are in play. */
export function albumHref(input: {
  base: string;
  token?: string | null;
  member?: string | null;
  q?: string;
  pages?: number;
}): string {
  const params = new URLSearchParams();
  if (input.token) params.set("m", input.token);
  if (input.member) params.set("member", input.member);
  if (input.q) params.set("q", input.q);
  if (input.pages && input.pages > 1) params.set("pages", String(input.pages));
  const query = params.toString();
  return query ? `${input.base}?${query}` : input.base;
}

/** The answer on the web issue that a gallery item belongs to. */
export function issueAnchor(anchor: string, issueId: string, token?: string | null): string {
  return `/i/${issueId}${token ? `?m=${encodeURIComponent(token)}` : ""}#${anchor}`;
}

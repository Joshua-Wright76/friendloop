import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { copy } from "./copy.ts";
import {
  ALBUM_PAGE_SIZE,
  escapeLike,
  issueAnchor,
  searchTerms,
  type AlbumFilters,
} from "./album-query.ts";

export type AlbumItem = {
  key: string;
  kind: "photo" | "voice";
  url: string;
  durationMs: number | null;
  /** The line the author put under a photo-wall photo; null everywhere else. */
  caption: string | null;
  /** What they wrote alongside the media, if anything. */
  body: string;
  /** The question or section it answers. */
  context: string;
  author: string;
  authorPhotoUrl: string | null;
  isYou: boolean;
  /** Where "view in issue" goes. */
  issueHref: string;
  issueId: string;
};

export type AlbumGroup = {
  issueId: string;
  number: number;
  name: string | null;
  deliveredAt: Date;
  items: AlbumItem[];
};

export type AlbumView = {
  groups: AlbumGroup[];
  /** Photos and voice notes matching the filters, across every screen. */
  total: number;
  shown: number;
  hasMore: boolean;
  /** Everyone who has put something in the album, for the "from" filter. */
  people: Array<{ id: string; name: string }>;
};

type Row = {
  kind: "photo" | "voice";
  key: string;
  url: string;
  duration_ms: number | null;
  caption: string | null;
  body: string;
  context: string;
  issue_id: string;
  number: number;
  issue_name: string | null;
  delivered_at: string | Date;
  anchor: string;
  member_id: string;
  author_name: string | null;
  author_email: string;
  author_photo: string | null;
};

/**
 * Every photo and voice note a delivered issue carries, one row each. Only
 * submitted answers of delivered issues; admin-only sections stay with the
 * admins who can already read them in the issue itself.
 */
function everything(groupId: string, viewerIsAdmin: boolean): SQL {
  return sql`
    select 'photo' as kind, 'photo-' || r.id::text as key, r.photo_url as url,
      null::integer as duration_ms, null::text as caption, r.body as body, q.text as context,
      i.id as issue_id, i.number as number, i.name as issue_name,
      coalesce(i.delivered_at, i.delivers_at) as delivered_at, 'answer-' || r.id::text as anchor,
      m.id as member_id, m.name as author_name, m.email as author_email, m.photo_url as author_photo,
      0 as source, q.position as context_position, 0 as media_position, r.created_at as created_at
    from replies r
    join issues i on i.id = r.issue_id
    join issue_questions q on q.id = r.issue_question_id
    join memberships m on m.id = r.membership_id
    where i.group_id = ${groupId} and i.status = 'delivered' and r.status = 'submitted' and r.photo_url is not null
    union all
    select 'voice', 'voice-' || r.id::text, r.audio_url,
      r.audio_duration_ms, null::text, r.body, q.text,
      i.id, i.number, i.name,
      coalesce(i.delivered_at, i.delivers_at), 'answer-' || r.id::text,
      m.id, m.name, m.email, m.photo_url,
      0, q.position, 1, r.created_at
    from replies r
    join issues i on i.id = r.issue_id
    join issue_questions q on q.id = r.issue_question_id
    join memberships m on m.id = r.membership_id
    where i.group_id = ${groupId} and i.status = 'delivered' and r.status = 'submitted' and r.audio_url is not null
    union all
    select 'photo', 'media-' || sm.id::text, sm.url,
      null::integer, sm.caption, sr.body, s.title,
      i.id, i.number, i.name,
      coalesce(i.delivered_at, i.delivers_at), 'section-reply-' || sr.id::text,
      m.id, m.name, m.email, m.photo_url,
      1, s.position, sm.position, sr.created_at
    from section_media sm
    join section_replies sr on sr.id = sm.section_reply_id
    join issue_sections s on s.id = sr.issue_section_id
    join issues i on i.id = sr.issue_id
    join memberships m on m.id = sr.membership_id
    where i.group_id = ${groupId} and i.status = 'delivered' and sr.status = 'submitted'
      and (s.admin_only = false or ${viewerIsAdmin})
  `;
}

function filterClause(filters: Pick<AlbumFilters, "member" | "q">): SQL {
  const conditions: SQL[] = [];
  if (filters.member) conditions.push(sql`a.member_id = ${filters.member}::uuid`);
  for (const word of searchTerms(filters.q)) {
    const pattern = `%${escapeLike(word)}%`;
    conditions.push(sql`(a.body ilike ${pattern} or a.caption ilike ${pattern} or a.context ilike ${pattern})`);
  }
  return conditions.length > 0 ? sql`where ${sql.join(conditions, sql` and `)}` : sql``;
}

function displayName(row: { author_name: string | null; author_email: string }): string {
  return row.author_name ?? row.author_email.split("@")[0];
}

/**
 * The Album: a read-only view over what members have already sent. It collects
 * nothing, and everything it shows is in a delivered issue the viewer can open.
 */
export async function loadAlbum(input: {
  groupId: string;
  viewerMembershipId: string;
  viewerIsAdmin: boolean;
  filters: AlbumFilters;
  /** Appended to "view in issue" so a link-holder stays recognised. */
  token?: string | null;
}): Promise<AlbumView> {
  const { groupId, viewerMembershipId, viewerIsAdmin, filters } = input;
  const limit = filters.pages * ALBUM_PAGE_SIZE;
  const union = everything(groupId, viewerIsAdmin);
  const where = filterClause(filters);

  const [items, counted, people] = await Promise.all([
    db.execute<Row>(sql`
      select a.* from (${union}) a ${where}
      order by a.number desc, a.source asc, a.context_position asc, a.created_at asc, a.media_position asc, a.key asc
      limit ${limit}
    `),
    db.execute<{ n: number }>(sql`select count(*)::int as n from (${union}) a ${where}`),
    db.execute<{ member_id: string; author_name: string | null; author_email: string }>(sql`
      select distinct a.member_id, a.author_name, a.author_email from (${union}) a
    `),
  ]);

  const groups: AlbumGroup[] = [];
  for (const row of items) {
    let group = groups[groups.length - 1];
    if (group?.issueId !== row.issue_id) {
      group = {
        issueId: row.issue_id,
        number: row.number,
        name: row.issue_name,
        deliveredAt: new Date(row.delivered_at),
        items: [],
      };
      groups.push(group);
    }
    const mine = row.member_id === viewerMembershipId;
    group.items.push({
      key: row.key,
      kind: row.kind,
      url: row.url,
      durationMs: row.duration_ms,
      caption: row.caption,
      body: row.body,
      context: row.context,
      author: mine ? copy.issue.you : displayName(row),
      authorPhotoUrl: row.author_photo,
      isYou: mine,
      issueHref: issueAnchor(row.anchor, row.issue_id, input.token),
      issueId: row.issue_id,
    });
  }

  const total = counted[0]?.n ?? 0;
  const shown = items.length;
  return {
    groups,
    total,
    shown,
    hasMore: shown < total,
    people: people
      .map((row) => ({ id: row.member_id, name: displayName(row) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
